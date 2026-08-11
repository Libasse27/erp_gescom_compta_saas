// Pile "non authentifié" — voir App.tsx : bascule vers AppStackParamList une
// fois useAuth().status === "authenticated".
export type AuthStackParamList = {
  Login: undefined;
  MfaVerify: { challengeToken: string };
};

// Pile "authentifié" — Home reste l'écran d'accueil (Phase 9.2). Le module
// Clients (Phase 9.4) est le premier écran ERP réel ; les autres modules
// suivront le même patron dans des cycles ultérieurs.
export type AppStackParamList = {
  Home: undefined;
  ClientsList: undefined;
  ClientForm: { customerId?: string } | undefined;
};
