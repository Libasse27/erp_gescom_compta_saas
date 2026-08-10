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

// Module ERP — Ventes (Phase 8, module 5). Contrairement à
// Customer/Supplier/Product (des fiches) et StockMovement (un mouvement
// isolé), Sale a des lignes (SaleLine) et un cycle de vie
// DRAFT -> CONFIRMED | CANCELLED (CONFIRMED terminal dans ce cycle). Aucun
// total n'est stocké côté base : totalExcludingTax/Vat/IncludingTax ici sont
// calculés côté API à partir des lignes (elles-mêmes un instantané figé du
// prix/TVA au moment de la vente), pas une donnée dérivée qui pourrait
// dériver. productCode/productName/customerName sont dénormalisés dans la
// réponse pour l'affichage, pas stockés en base.
export type SaleStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";

export interface SaleLine {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPriceExcludingTax: number;
  vatRateBasisPoints: number;
  lineTotalExcludingTax: number;
  lineTotalVat: number;
  lineTotalIncludingTax: number;
}

export interface Sale {
  id: string;
  enterpriseId: string;
  customerId: string;
  customerName: string;
  status: SaleStatus;
  saleDate: string;
  notes: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  lines: SaleLine[];
  createdAt: string;
  updatedAt: string;
}

// Module ERP — Achats (Phase 8, module 6). Miroir structurel de Sale/SaleLine
// (même cycle de vie, mêmes totaux calculés côté API), mais lié à Supplier
// plutôt que Customer, et unitCostExcludingTax (au lieu de
// unitPriceExcludingTax) : le coût d'achat est saisi à la création, pas
// résolu depuis un prix catalogue (Product ne porte pas de prix d'achat).
export type PurchaseStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";

export interface PurchaseLine {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitCostExcludingTax: number;
  vatRateBasisPoints: number;
  lineTotalExcludingTax: number;
  lineTotalVat: number;
  lineTotalIncludingTax: number;
}

export interface Purchase {
  id: string;
  enterpriseId: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseStatus;
  purchaseDate: string;
  notes: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  lines: PurchaseLine[];
  createdAt: string;
  updatedAt: string;
}

// Module ERP — Facturation (Phase 8, module 7). Transforme une Sale
// CONFIRMED en document légal : pas de lignes propres, InvoiceLine reprend
// simplement la forme de SaleLine (les lignes viennent de la vente liée,
// jamais ressaisies — voir schema.prisma, model SalesInvoice). "DRAFT" de
// l'enum Prisma InvoiceStatus n'existe pas ici : une facture est émise
// directement à la création.
export type SalesInvoiceStatus = "ISSUED" | "PAID" | "VOID";

export interface SalesInvoiceLine {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPriceExcludingTax: number;
  vatRateBasisPoints: number;
  lineTotalExcludingTax: number;
  lineTotalVat: number;
  lineTotalIncludingTax: number;
}

export interface SalesInvoice {
  id: string;
  enterpriseId: string;
  saleId: string;
  customerId: string;
  customerName: string;
  number: string;
  status: SalesInvoiceStatus;
  issuedAt: string;
  paidAt: string | null;
  voidedAt: string | null;
  legalMentions: string;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  lines: SalesInvoiceLine[];
  createdAt: string;
  updatedAt: string;
}
