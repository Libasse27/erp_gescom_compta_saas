import { defaultShouldDehydrateQuery, QueryClient, type Query } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { setupOnlineManager } from "./network";
import { sqlitePersister } from "./persister";

// Liste blanche de ce qui va sur disque (ADR-0014 §"liste blanche de ce qui
// est persisté" : plus sûr de la poser maintenant, tant qu'elle est courte,
// qu'après coup une fois plusieurs modules écrits dans le cache). Sans ça,
// toute query réussie serait persistée, y compris une future query qui
// contiendrait par accident un jeton. Préfixe exact (pas une comparaison du
// seul premier segment) : ["users"] seul inclurait par erreur un futur
// module préfixé différemment sous "users".
const DEHYDRATE_ALLOW_LIST: readonly (readonly unknown[])[] = [
  ["customers"], // liste + fiche client (Phase 9.4)
  ["suppliers"], // liste + fiche fournisseur (Phase 9.5)
  ["products"], // liste + fiche produit (Phase 9.6)
  ["stock"], // niveaux de stock calculés (Phase 9.7)
  ["stock-movements"], // historique de mouvements par produit (Phase 9.7)
  ["sales"], // liste des ventes (Phase 9.8)
  ["sale"], // détail d'une vente avec ses lignes (Phase 9.8) — préfixe exact,
  // ne recoupe pas ["sales"] (égalité de segment stricte, "sale" !== "sales")
  ["users", "me", "context"], // permissions — sans ça, un cold start
  // hors-ligne masquerait les entrées "Clients"/"Fournisseurs" alors que
  // leurs listes, elles, resteraient consultables depuis le cache.
];

// Exporté pour test (revue sécurité Phase 9.4) : c'est le seul contrôle qui
// décide de ce qui atterrit en clair sur erp-offline.db, une régression ici
// (ex: préfixe élargi par erreur) ne doit pas être invisible en CI.
export function isAllowedToPersist(queryKey: readonly unknown[]): boolean {
  return DEHYDRATE_ALLOW_LIST.some((prefix) => prefix.every((segment, index) => queryKey[index] === segment));
}

function shouldDehydrateQuery(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && isAllowedToPersist(query.queryKey);
}

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
    dehydrateOptions: { shouldDehydrateQuery },
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
