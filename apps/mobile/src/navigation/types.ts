// Pile "non authentifié" — voir App.tsx : bascule vers AppStackParamList une
// fois useAuth().status === "authenticated".
export type AuthStackParamList = {
  Login: undefined;
  MfaVerify: { challengeToken: string };
};

// Pile "authentifié" — Home est un écran d'accueil temporaire (Phase 9.2),
// les écrans ERP réels arrivent en Phase 9.4.
export type AppStackParamList = {
  Home: undefined;
};
