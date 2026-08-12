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
// sur PurchaseForm — voir PurchaseFormScreen.tsx. Facturation (Phase 9.10) :
// InvoiceForm ne contient qu'un picker de vente confirmée (pas de lignes,
// jamais ressaisies — voir InvoiceFormScreen.tsx), InvoiceDetail expose
// marquer payée/annuler à la place de confirmer/annuler. Comptabilité
// (Phase 9.11) : deux ressources distinctes (Account, JournalEntry) plutôt
// qu'une seule fiche — AccountsList est l'entrée Home, JournalEntriesList et
// TrialBalance ne sont atteints que depuis AccountsList (même sortie que
// StockMovementHistory/Form depuis StockLevels, module 4).
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
  InvoicesList: undefined;
  InvoiceForm: undefined;
  InvoiceDetail: { invoiceId: string };
  AccountsList: undefined;
  AccountForm: undefined;
  JournalEntriesList: undefined;
  JournalEntryForm: undefined;
  JournalEntryDetail: { entryId: string };
  TrialBalance: undefined;
  // Rapports (Phase 9.12, dernier module ERP) : lecture seule, aucun modèle
  // Prisma propre — un seul écran agrégeant les trois rapports, pas de
  // liste/formulaire/détail.
  Reports: undefined;
};
