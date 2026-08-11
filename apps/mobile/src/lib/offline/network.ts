import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";
import NetInfo from "@react-native-community/netinfo";

// Source unique de vérité réseau : NetInfo alimente onlineManager de
// TanStack Query, et tout le reste (useIsOnline ci-dessous, le déclencheur
// de rejeu de sync-engine.ts) lit onlineManager plutôt que de posséder son
// propre abonnement NetInfo.
export function setupOnlineManager(): void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      // isInternetReachable peut être null juste après le démarrage sur
      // certaines plateformes ; le traiter comme "en ligne" évite un flash
      // "hors-ligne" au lancement le temps que NetInfo confirme l'état réel.
      setOnline(!!state.isConnected && state.isInternetReachable !== false);
    }),
  );
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(
    onlineManager.subscribe.bind(onlineManager),
    () => onlineManager.isOnline(),
  );
}
