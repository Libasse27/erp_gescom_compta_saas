import { PermissionKey } from "./permission-keys";

// Rôles seedés pour chaque nouvelle entreprise (Phase 6), librement
// renommables/modifiables ensuite par l'ADMIN de cette entreprise sans
// impact sur les autres tenants (voir docs/database/SCHEMA.md §4).
export const DEFAULT_ROLE_NAMES = [
  "ADMIN",
  "COMPTABLE",
  "COMMERCIAL",
  "CAISSIER",
  "MAGASINIER",
  "GESTIONNAIRE",
  "LECTEUR",
] as const;

export type DefaultRoleName = (typeof DEFAULT_ROLE_NAMES)[number];

const ALL_READ: PermissionKey[] = [
  "clients.read",
  "suppliers.read",
  "products.read",
  "sales.read",
  "purchases.read",
  "stock.read",
  "accounting.read",
  "reports.read",
];

const ALL_PERMISSIONS: PermissionKey[] = [
  "clients.read",
  "clients.create",
  "clients.update",
  "clients.delete",
  "suppliers.read",
  "suppliers.create",
  "suppliers.update",
  "suppliers.delete",
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
];

// Mapping par défaut rôle → permissions, utilisé par le seed de
// provisioning (Phase 6) pour peupler RolePermission. Purement indicatif :
// l'ADMIN peut ensuite librement modifier les permissions de chaque rôle
// dans son entreprise (docs/SPECIFICATIONS-SAAS.md §12).
export const DEFAULT_ROLE_PERMISSIONS: Record<DefaultRoleName, PermissionKey[]> = {
  ADMIN: ALL_PERMISSIONS,
  COMPTABLE: ["accounting.read", "accounting.create", "accounting.update", "reports.read", "clients.read", "suppliers.read", "sales.read", "purchases.read"],
  COMMERCIAL: ["clients.read", "clients.create", "clients.update", "sales.read", "sales.create", "sales.update", "products.read", "reports.read"],
  CAISSIER: ["sales.read", "sales.create", "stock.read", "clients.read"],
  MAGASINIER: ["stock.read", "stock.create", "stock.update", "stock.delete", "products.read", "products.update", "purchases.read", "suppliers.read"],
  GESTIONNAIRE: [
    "clients.read", "clients.create", "clients.update", "clients.delete",
    "suppliers.read", "suppliers.create", "suppliers.update", "suppliers.delete",
    "products.read", "products.create", "products.update", "products.delete",
    "sales.read", "sales.create", "sales.update", "sales.delete",
    "purchases.read", "purchases.create", "purchases.update", "purchases.delete",
    "stock.read", "stock.create", "stock.update", "stock.delete",
    "accounting.read", "reports.read",
  ],
  LECTEUR: ALL_READ,
};
