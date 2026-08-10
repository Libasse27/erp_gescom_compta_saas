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
