// Pile "non authentifié" — voir App.tsx : bascule vers AppStackParamList une
// fois useAuth().status === "authenticated".
export type AuthStackParamList = {
  Login: undefined;
  MfaVerify: { challengeToken: string };
};

// Pile "authentifié" — Home reste l'écran d'accueil (Phase 9.2). Clients
// (Phase 9.4) et Fournisseurs (Phase 9.5) suivent le même patron ; les
// modules suivants répliqueront la même forme dans des cycles ultérieurs.
export type AppStackParamList = {
  Home: undefined;
  ClientsList: undefined;
  ClientForm: { customerId?: string } | undefined;
  SuppliersList: undefined;
  SupplierForm: { supplierId?: string } | undefined;
};
