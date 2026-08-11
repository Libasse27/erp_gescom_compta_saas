import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { readCache, writeCache } from "./db";

// Persister maison adossé à la table query_cache (un blob JSON, pas de
// découpage relationnel — seule la file de mutations a besoin d'être
// interrogeable). Aucun persister officiel TanStack ne cible SQLite ; les
// deux packages officiels (async-storage/sync-storage) sont de simples
// magasins clé-valeur, ~40 lignes suffisent ici plutôt qu'ajouter une
// dépendance pour ça.
export const sqlitePersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    await writeCache(JSON.stringify(client));
  },
  restoreClient: async () => {
    const raw = await readCache();
    return raw ? (JSON.parse(raw) as PersistedClient) : undefined;
  },
  removeClient: async () => {
    await writeCache(null);
  },
};
