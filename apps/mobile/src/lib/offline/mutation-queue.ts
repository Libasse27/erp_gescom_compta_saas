import { apiFetch } from "../api";
import {
  incrementRetry,
  insertMutation,
  listMutations as listAllMutations,
  listPendingMutations,
  markMutationDone,
  markMutationFailed,
  markMutationPending,
  markMutationProcessing,
} from "./db";
import type { HttpMethod, MutationScope, QueuedMutation } from "./types";

const MAX_TRANSIENT_RETRIES = 5;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;

// Garde-fou structurel à l'enqueue, pas seulement à l'usage : un chemin
// relatif simple, sans schéma/hôte, sans segment ".." ni double slash.
// Rien n'appelle encore enqueueMutation en dehors des tests dans ce cycle
// (aucun écran ERP, Phase 9.4), mais la validation doit exister avant que
// des sites d'appel n'apparaissent, pas être ajoutée après coup (revue
// sécurité Phase 9.3).
const VALID_MUTATION_PATH = /^\/[A-Za-z0-9\-._~/]*$/;

function assertValidMutationPath(path: string): void {
  if (!VALID_MUTATION_PATH.test(path) || path.includes("..") || path.includes("//")) {
    throw new Error(`Chemin de mutation invalide : ${path}`);
  }
}

export interface EnqueueMutationInput {
  method: HttpMethod;
  path: string;
  body?: unknown;
  scope?: MutationScope;
}

export interface ProcessQueueDeps {
  getAccessToken: () => string | null;
}

// Persistée immédiatement (SQLite) — survit à un kill de l'app avant tout
// rejeu. Aucun ID généré côté client : le serveur reste seul juge de
// l'identité de l'enregistrement créé (ADR-0014, politique dernier-écrit-gagne).
export async function enqueueMutation(input: EnqueueMutationInput): Promise<QueuedMutation> {
  assertValidMutationPath(input.path);
  return insertMutation(input);
}

// Toutes les mutations, y compris 'failed' — exposé pour une future UI
// (Phase 9.4) : une mutation en échec terminal n'est jamais supprimée
// silencieusement.
export async function listMutations(): Promise<QueuedMutation[]> {
  return listAllMutations();
}

let isProcessing = false;

// Rejeu séquentiel, FIFO par id — jamais en parallèle : deux modifications
// du même enregistrement ERP doivent s'appliquer dans l'ordre, même en
// dernier-écrit-gagne. Un échec réseau ou un échec transitoire en attente de
// backoff arrête le traitement du reste du lot (l'ordre ne doit pas être
// contourné en sautant une mutation bloquée pour tenter la suivante).
export async function processQueue(deps: ProcessQueueDeps): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    const pending = await listPendingMutations();
    for (const mutation of pending) {
      const outcome = await processOne(mutation, deps);
      if (outcome === "stop") {
        break;
      }
    }
  } finally {
    isProcessing = false;
  }
}

type ProcessOutcome = "continue" | "stop";

async function processOne(mutation: QueuedMutation, deps: ProcessQueueDeps): Promise<ProcessOutcome> {
  const accessToken = deps.getAccessToken();
  if (!accessToken) {
    // Pas de jeton en mémoire : la file n'essaie jamais de forcer un refresh
    // elle-même (voir ADR-0014) — elle est rejouée uniquement quand
    // sync-engine.ts détecte une session authentifiée, où un jeton existe
    // par construction. Arrêt défensif si appelée hors de ce contexte.
    return "stop";
  }

  await markMutationProcessing(mutation.id);

  let response: Response;
  try {
    response = await apiFetch(mutation.path, {
      method: mutation.method,
      headers: { Authorization: `Bearer ${accessToken}` },
      body: mutation.body !== undefined ? JSON.stringify(mutation.body) : undefined,
    });
  } catch {
    // Échec réseau (fetch qui lève/timeout) : toujours hors-ligne, ce n'est
    // pas la faute de la mutation — remise en pending, retryCount intact.
    await markMutationPending(mutation.id);
    return "stop";
  }

  if (response.ok) {
    await markMutationDone(mutation.id);
    return "continue";
  }

  if (response.status === 401) {
    // Jeton expiré en cours de rejeu (access token 15 min, plausible sur une
    // longue session ou un long passage hors-ligne) : ce n'est pas un rejet
    // métier de la mutation elle-même, à ne pas confondre avec les 4xx
    // ci-dessous — remise en pending sans incrémenter retryCount, arrêt de
    // la file. Le prochain déclenchement de sync-engine.ts (avec un jeton
    // rafraîchi) la retentera (revue sécurité Phase 9.3).
    await markMutationPending(mutation.id);
    return "stop";
  }

  if (response.status >= 500 || response.status === 429) {
    const nextRetryCount = mutation.retryCount + 1;
    if (nextRetryCount >= MAX_TRANSIENT_RETRIES) {
      await markMutationFailed(mutation.id, `HTTP ${response.status} après ${nextRetryCount} tentatives`);
      return "continue";
    }
    await incrementRetry(mutation.id, `HTTP ${response.status}`);
    scheduleRetry(nextRetryCount, deps);
    return "stop";
  }

  // 4xx métier (400/403/404/409/422) : rejouer une erreur de validation à
  // l'infini est du bruit, pas une panne transitoire — échec terminal
  // immédiat, on continue avec le reste de la file.
  await markMutationFailed(mutation.id, `HTTP ${response.status}`);
  return "continue";
}

// Best-effort : si l'app est tuée avant l'expiration du délai, le timer est
// perdu, mais la ligne reste 'processing'/'pending' en SQLite et sera reprise
// au prochain déclenchement de sync-engine.ts (reconnexion ou retour en
// session authentifiée) — le timer accélère une session longue au premier
// plan, il n'est pas la seule garantie de rejeu.
function scheduleRetry(retryCount: number, deps: ProcessQueueDeps): void {
  const delay = Math.min(2 ** retryCount * BASE_BACKOFF_MS, MAX_BACKOFF_MS);
  setTimeout(() => {
    processQueue(deps).catch(() => undefined);
  }, delay);
}
