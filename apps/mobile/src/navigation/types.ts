// Pile "non authentifié" — voir App.tsx : bascule vers AppStackParamList une
// fois useAuth().status === "authenticated".
export type AuthStackParamList = {
  Login: undefined;
  MfaVerify: { challengeToken: string };
};

// Pile "authentifié" — Home reste l'écran d'accueil (Phase 9.2). Clients
// (Phase 9.4), Fournisseurs (Phase 9.5) et Produits (Phase 9.6) suivent le
// patron "fiche" (liste + formulaire créer/éditer). Stock (Phase 9.7) rompt ce
// patron : StockMovement est un grand livre append-only, pas de mode édition
// (StockMovementForm ne fait que pré-remplir le produit), et un écran
// d'historique dédié par produit sans équivalent dans les modules précédents.
export type AppStackParamList = {
  Home: undefined;
  ClientsList: undefined;
  ClientForm: { customerId?: string } | undefined;
  SuppliersList: undefined;
  SupplierForm: { supplierId?: string } | undefined;
  ProductsList: undefined;
  ProductForm: { productId?: string } | undefined;
  StockLevels: undefined;
  StockMovementForm: { productId?: string } | undefined;
  StockMovementHistory: { productId: string; productCode: string; productName: string };
};
