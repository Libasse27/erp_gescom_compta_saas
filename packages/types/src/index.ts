// Types et DTO partagés entre apps/api, apps/web, apps/mobile, apps/desktop.
// Contenu ajouté à partir de la Phase 1 (modèle de domaine SaaS).

// Module ERP — Clients (Phase 8). En miroir de l'enum Prisma CustomerType
// (apps/api/prisma/schema.prisma) : ce package ne dépend pas de @prisma/client,
// donc les valeurs sont dupliquées ici comme source de vérité compile-time
// côté front/validation, au même titre que packages/permissions pour les clés
// de permission.
export const CUSTOMER_TYPES = ["INDIVIDUAL", "COMPANY"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export interface Customer {
  id: string;
  enterpriseId: string;
  type: CustomerType;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string;
  ninea: string | null;
  rccm: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Module ERP — Fournisseurs (Phase 8, module 2). Copie conforme de Customer,
// réutilise CustomerType (INDIVIDUAL/COMPANY) — même distinction, pas de
// SupplierType dupliqué.
export interface Supplier {
  id: string;
  enterpriseId: string;
  type: CustomerType;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string;
  ninea: string | null;
  rccm: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Module ERP — Produits (Phase 8, module 3). Contrairement à
// Customer/Supplier, un produit n'est pas un tiers : nouveau modèle de
// champs (code unique par entreprise, prix HT + TVA, suivi de stock), pas
// une copie. Prix stocké HT (sellingPriceExcludingTax) + taux de TVA en
// points de base (vatRateBasisPoints, 1800 = 18 %) — le TTC se calcule à
// l'affichage, jamais stocké.
export interface Product {
  id: string;
  enterpriseId: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  category: string | null;
  barcode: string | null;
  sellingPriceExcludingTax: number;
  vatRateBasisPoints: number;
  trackStock: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Module ERP — Stock (Phase 8, module 4). Contrairement à
// Customer/Supplier/Product (des fiches), pas une entité mais un grand
// livre de mouvements : StockMovement est la seule source de vérité,
// append-only (pas de champ quantité stocké sur Product). StockLevel est la
// vue calculée (agrégation des mouvements) consommée par la liste
// GET /stock, pas un modèle Prisma.
export type StockMovementType = "IN" | "OUT" | "ADJUSTMENT";

export interface StockMovement {
  id: string;
  enterpriseId: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  note: string | null;
  createdAt: string;
}

export interface StockLevel {
  productId: string;
  code: string;
  name: string;
  unit: string;
  quantityOnHand: number;
}
