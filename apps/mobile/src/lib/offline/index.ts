import { purgeTenantScoped } from "./db";
import { sqlitePersister } from "./persister";
import { queryClient, withPersistenceSuspended } from "./query-client";

export { queryClient } from "./query-client";
export { useIsOnline } from "./network";
export { useSyncEngine } from "./sync-engine";
export { assertMutationSucceeded, enqueueMutation, listMutations, MutationRejectedError, processQueue } from "./mutation-queue";
export type { EnqueueMutationInput } from "./mutation-queue";
export type { QueuedMutation, MutationStatus, MutationScope, HttpMethod } from "./types";

// Appelée au logout et à l'expiration de session (auth-context.tsx) : aucune
// donnée d'un tenant ne doit survivre localement à un changement de compte
// (CLAUDE.md §7 / docs/adr/0012-...). Vide le cache TanStack Query en
// mémoire ET sur disque, et la file de mutations (hors mutations 'auth'
// réservées, non câblées ce cycle — voir docs/adr/0014-...).
//
// La persistance automatique est suspendue le temps de la purge
// (withPersistenceSuspended) pour qu'une requête encore observée par un
// écran monté ne ré-écrive pas des données juste après le DELETE (revue
// sécurité Phase 9.3). Les deux opérations disque sont tentées via
// allSettled plutôt qu'en série stricte : un échec sur l'une ne doit pas
// empêcher la tentative de l'autre — un échec partiel reste signalé à
// l'appelant plutôt que masqué.
export async function purgeOfflineStore(): Promise<void> {
  await withPersistenceSuspended(async () => {
    queryClient.clear();
    const results = await Promise.allSettled([sqlitePersister.removeClient(), purgeTenantScoped()]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason as unknown),
        "Échec partiel de la purge du cache hors-ligne",
      );
    }
  });
}
