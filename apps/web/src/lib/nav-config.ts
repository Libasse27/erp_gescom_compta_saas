// Source unique du menu de l'espace entreprise — jamais dupliqué ni codé en
// dur ailleurs (docs/PROMPT-MAITRE-SAAS.md Phase 7.2, "menu généré depuis
// Rôle × Permissions × Plan"). permission=null => toujours visible.
export interface NavItem {
  href: string;
  label: string;
  permission: string | null;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "Vue générale", permission: null },
  { href: "/app/clients", label: "Clients", permission: "clients.read" },
  { href: "/app/products", label: "Produits", permission: "products.read" },
  { href: "/app/sales", label: "Ventes", permission: "sales.read" },
  { href: "/app/purchases", label: "Achats", permission: "purchases.read" },
  { href: "/app/stock", label: "Stocks", permission: "stock.read" },
  { href: "/app/accounting", label: "Comptabilité", permission: "accounting.read" },
  { href: "/app/reports", label: "Rapports", permission: "reports.read" },
  { href: "/app/users", label: "Utilisateurs", permission: "users.manage" },
  { href: "/app/subscription", label: "Abonnement", permission: "billing.manage" },
  { href: "/app/settings", label: "Paramètres", permission: "settings.manage" },
];
