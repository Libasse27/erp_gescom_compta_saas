// Catalogue de permissions — source de vérité compile-time, en miroir de la
// table Permission (apps/api/prisma/schema.prisma), seedée par
// apps/api/prisma/seed.ts. Toute clé ajoutée ici doit être ajoutée au seed.
export const PERMISSION_KEYS = [
  "clients.read",
  "clients.create",
  "clients.update",
  "clients.delete",

  "products.read",
  "products.create",
  "products.update",
  "products.delete",

  "sales.read",
  "sales.create",
  "sales.update",
  "sales.delete",

  "purchases.read",
  "purchases.create",
  "purchases.update",
  "purchases.delete",

  "stock.read",
  "stock.create",
  "stock.update",
  "stock.delete",

  "accounting.read",
  "accounting.create",
  "accounting.update",

  "reports.read",

  "users.manage",
  "settings.manage",
  "billing.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}
