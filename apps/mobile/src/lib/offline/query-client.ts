import { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { setupOnlineManager } from "./network";
import { sqlitePersister } from "./persister";

// À incrémenter à chaque changement de forme incompatible des données mises
// en cache (nouveau champ requis, structure de réponse modifiée) : purge
// silencieusement tout cache persistant qui ne correspond plus.
const CACHE_SCHEMA_VERSION = "v1";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Doit être >= maxAge du persister ci-dessous (piège classique
      // TanStack Query : gcTime plus court que maxAge purge une entrée
      // avant même que le persister ait eu la chance de la restaurer).
      gcTime: ONE_DAY_MS,
    },
  },
});

// Effets de bord au chargement du module (pas dans un composant) : la
// réhydratation est en vol avant le premier rendu, pas d'écran de chargement
// supplémentaire à gérer dans App.tsx.
setupOnlineManager();

// persistQueryClient s'abonne au cache et ré-écrit sur disque à chaque
// requête ajoutée/modifiée, sans throttle. Sans pouvoir suspendre cet
// abonnement, purgeOfflineStore() (offline/index.ts) risquerait une course :
// une requête encore observée par un écran monté pourrait ré-écrire des
// données sur disque juste après le DELETE de la purge (revue sécurité
// Phase 9.3, docs/adr/0014-...). On conserve donc la fonction d'arrêt
// retournée pour pouvoir couper puis relancer la persistance autour de la
// purge.
let stopPersisting: (() => void) | undefined;

function startPersisting(): void {
  const [stop] = persistQueryClient({
    queryClient,
    persister: sqlitePersister,
    // Un appareil resté hors-ligne plus d'un jour affiche un état de
    // chargement plutôt que des données financières potentiellement obsolètes.
    maxAge: ONE_DAY_MS,
    buster: CACHE_SCHEMA_VERSION,
  });
  stopPersisting = stop;
}

startPersisting();

// Appelé uniquement par purgeOfflineStore() : coupe la persistance avant de
// vider le cache pour qu'aucune écriture en vol ne ré-insère des données
// juste après le DELETE, puis relance immédiatement la persistance (la
// prochaine session doit continuer à écrire sur disque normalement).
export function withPersistenceSuspended<T>(action: () => Promise<T>): Promise<T> {
  stopPersisting?.();
  stopPersisting = undefined;
  return action().finally(() => {
    startPersisting();
  });
}
