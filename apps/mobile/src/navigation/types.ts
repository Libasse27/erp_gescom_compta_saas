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
// Ventes (Phase 9.8) : première entité à lignes — SaleForm est
// création-uniquement (aucune route de modification des lignes côté API),
// SaleDetail est lecture seule + actions de cycle de vie (confirmer/annuler).
// Achats (Phase 9.9) : miroir structurel de Ventes (mêmes statuts, même
// écrans liste/formulaire/détail), avec un champ coût unitaire saisi en plus
// sur PurchaseForm — voir PurchaseFormScreen.tsx.
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
  SalesList: undefined;
  SaleForm: undefined;
  SaleDetail: { saleId: string };
  PurchasesList: undefined;
  PurchaseForm: undefined;
  PurchaseDetail: { purchaseId: string };
};
