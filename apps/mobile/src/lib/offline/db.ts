import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import type { HttpMethod, MutationScope, MutationStatus, QueuedMutation } from "./types";

// Seul fichier du module offline à importer expo-sqlite — tout le reste passe
// par cette frontière typée (mockable sans toucher au natif, voir les specs).
// Ouverture + migration synchrones : la base doit être prête avant le premier
// rendu React (query-client.ts s'initialise au chargement du module, pas
// dans un effet), donc pas d'écran de chargement supplémentaire dans App.tsx.
const db: SQLiteDatabase = openDatabaseSync("erp-offline.db");

function migrate(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS query_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      savedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mutation_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      body TEXT,
      scope TEXT NOT NULL DEFAULT 'tenant',
      status TEXT NOT NULL DEFAULT 'pending',
      retryCount INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      idempotencyKey TEXT NOT NULL DEFAULT '',
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mutation_queue_status ON mutation_queue(status, id);
  `);

  // Corrige MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) : colonne ajoutée
  // après la création initiale de mutation_queue — CREATE TABLE IF NOT
  // EXISTS ne modifie pas un schéma déjà présent sur un appareil où l'app
  // était déjà installée. Migration légère et idempotente, sans backfill
  // nécessaire (une ligne 'pending' déjà en file avant cette mise à jour
  // n'a jamais eu de clé côté serveur non plus ; NOT NULL DEFAULT '' au
  // lieu de NULL — SQLite ne distingue pas '' de NULL pour l'unicité, sans
  // objet ici puisque la déduplication est gérée côté API, pas en local).
  const columns = db.getAllSync<{ name: string }>("PRAGMA table_info(mutation_queue)");
  if (!columns.some((column) => column.name === "idempotencyKey")) {
    db.execSync("ALTER TABLE mutation_queue ADD COLUMN idempotencyKey TEXT NOT NULL DEFAULT ''");
  }
}

migrate();

// Pas un secret ni un identifiant métier (le serveur reste seul générateur
// d'ID, ADR-0014) — une clé de déduplication n'a besoin que d'une
// probabilité de collision négligeable, pas de garanties cryptographiques.
// crypto.randomUUID() est disponible sur les runtimes Hermes récents, mais
// pas garanti sur toute configuration Expo : repli sans dépendance
// supplémentaire plutôt que d'ajouter expo-crypto pour ce seul besoin
// (CLAUDE.md §3 : dépendance non triviale à justifier).
let fallbackKeyCounter = 0;
function generateIdempotencyKey(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (globalCrypto?.randomUUID) {
    return globalCrypto.randomUUID();
  }
  fallbackKeyCounter += 1;
  return `mut-${Date.now().toString(36)}-${fallbackKeyCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// --- query_cache : une seule ligne, blob JSON du persister TanStack Query ---

export async function readCache(): Promise<string | null> {
  const row = await db.getFirstAsync<{ data: string }>("SELECT data FROM query_cache WHERE id = 1");
  return row?.data ?? null;
}

export async function writeCache(data: string | null): Promise<void> {
  if (data === null) {
    await db.runAsync("DELETE FROM query_cache WHERE id = 1");
    return;
  }
  await db.runAsync(
    `INSERT INTO query_cache (id, data, savedAt) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, savedAt = excluded.savedAt`,
    [data, Date.now()],
  );
}

// --- mutation_queue ---

interface MutationQueueRow {
  id: number;
  method: HttpMethod;
  path: string;
  body: string | null;
  scope: MutationScope;
  status: MutationStatus;
  retryCount: number;
  lastError: string | null;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
}

function rowToMutation(row: MutationQueueRow): QueuedMutation {
  return {
    id: row.id,
    method: row.method,
    path: row.path,
    body: row.body === null ? undefined : (JSON.parse(row.body) as unknown),
    scope: row.scope,
    status: row.status,
    retryCount: row.retryCount,
    lastError: row.lastError,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function insertMutation(input: {
  method: HttpMethod;
  path: string;
  body?: unknown;
  scope?: MutationScope;
}): Promise<QueuedMutation> {
  const now = Date.now();
  const bodyJson = input.body === undefined ? null : JSON.stringify(input.body);
  // Corrige MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) : générée une seule
  // fois ici, à l'insertion — jamais régénérée à chaque rejeu de processOne
  // (mutation-queue.ts), qui la lit depuis cette ligne. Générée pour toute
  // mutation, pas seulement les créations financières : l'API décide quels
  // endpoints en tiennent compte, l'infrastructure reste générique.
  const idempotencyKey = generateIdempotencyKey();
  const result = await db.runAsync(
    "INSERT INTO mutation_queue (method, path, body, scope, idempotencyKey, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [input.method, input.path, bodyJson, input.scope ?? "tenant", idempotencyKey, now, now],
  );
  const row = await db.getFirstAsync<MutationQueueRow>("SELECT * FROM mutation_queue WHERE id = ?", [
    result.lastInsertRowId,
  ]);
  if (!row) {
    throw new Error("Échec de la lecture de la mutation qui vient d'être insérée");
  }
  return rowToMutation(row);
}

// Inclut 'processing' : une ligne laissée dans cet état par un kill de l'app
// en plein rejeu doit être retentée au prochain démarrage, pas oubliée.
export async function listPendingMutations(): Promise<QueuedMutation[]> {
  const rows = await db.getAllAsync<MutationQueueRow>(
    "SELECT * FROM mutation_queue WHERE status IN ('pending', 'processing') ORDER BY id ASC",
  );
  return rows.map(rowToMutation);
}

export async function listMutations(): Promise<QueuedMutation[]> {
  const rows = await db.getAllAsync<MutationQueueRow>("SELECT * FROM mutation_queue ORDER BY id ASC");
  return rows.map(rowToMutation);
}

export async function markMutationProcessing(id: number): Promise<void> {
  await db.runAsync("UPDATE mutation_queue SET status = 'processing', updatedAt = ? WHERE id = ?", [Date.now(), id]);
}

export async function markMutationPending(id: number): Promise<void> {
  await db.runAsync("UPDATE mutation_queue SET status = 'pending', updatedAt = ? WHERE id = ?", [Date.now(), id]);
}

// Une mutation traitée avec succès n'a plus de valeur informative : elle est
// supprimée plutôt que gardée dans un état 'done' qui ferait grossir la table
// indéfiniment sans jamais être consultée.
export async function markMutationDone(id: number): Promise<void> {
  await db.runAsync("DELETE FROM mutation_queue WHERE id = ?", [id]);
}

export async function markMutationFailed(id: number, error: string): Promise<void> {
  await db.runAsync("UPDATE mutation_queue SET status = 'failed', lastError = ?, updatedAt = ? WHERE id = ?", [
    error,
    Date.now(),
    id,
  ]);
}

export async function incrementRetry(id: number, error: string): Promise<void> {
  await db.runAsync(
    "UPDATE mutation_queue SET retryCount = retryCount + 1, lastError = ?, updatedAt = ? WHERE id = ?",
    [error, Date.now(), id],
  );
}

// Appelée au logout / à l'expiration de session (CLAUDE.md §7 : aucune
// donnée d'un tenant ne doit survivre localement à un changement de compte).
// Les mutations 'auth' (réservées, non câblées ce cycle) survivent au purge.
export async function purgeTenantScoped(): Promise<void> {
  await db.runAsync("DELETE FROM mutation_queue WHERE scope != 'auth'");
}
