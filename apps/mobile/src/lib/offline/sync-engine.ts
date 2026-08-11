import { useEffect, useRef } from "react";
import { useAuth } from "../auth-context";
import { processQueue } from "./mutation-queue";
import { useIsOnline } from "./network";
import { queryClient } from "./query-client";

// Déclenche le rejeu de la file de mutations quand une session authentifiée
// ET une connexion réseau sont toutes les deux disponibles — au passage à
// authentifié pendant qu'on est déjà en ligne, ou à la reconnexion pendant
// qu'on est déjà authentifié. Ne déclenche rien dans les autres cas.
export function useSyncEngine(): void {
  const { status, accessToken } = useAuth();
  const isOnline = useIsOnline();

  // Un ref plutôt qu'une dépendance d'effet directe : le jeton d'accès
  // tourne périodiquement sans que ça doive re-déclencher un rejeu, seule sa
  // valeur au moment de l'appel compte (voir mutation-queue.ts). Mise à jour
  // dans un effet (pas pendant le rendu) — règle react-hooks/refs.
  const accessTokenRef = useRef(accessToken);
  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    if (status !== "authenticated" || !isOnline) {
      return;
    }
    // Rafraîchit tout ce qui est monté une fois le rejeu terminé : une liste
    // laissée obsolète par une mutation créée hors-ligne (ou déjà en ligne,
    // voir use-customers.ts) ne se met sinon à jour qu'au prochain
    // invalidateQueries explicite d'un appelant — ici, c'est le seul point
    // qui sait qu'un rejeu déclenché par une reconnexion vient d'aboutir.
    processQueue({ getAccessToken: () => accessTokenRef.current })
      .then(() => queryClient.invalidateQueries())
      .catch(() => undefined);
  }, [status, isOnline]);
}
