// Menu Super Admin (docs/SPECIFICATIONS-SAAS.md §13) — pas de filtrage par
// permission ici : un Super Admin voit tout, contrairement au menu
// entreprise (lib/nav-config.ts, filtré par Rôle × Permissions × Plan).
export interface SuperAdminNavItem {
  href: string;
  label: string;
}

export const SUPER_ADMIN_NAV_ITEMS: SuperAdminNavItem[] = [
  { href: "/super-admin", label: "Vue générale" },
  { href: "/super-admin/enterprises", label: "Entreprises" },
  { href: "/super-admin/users", label: "Utilisateurs" },
  { href: "/super-admin/subscriptions", label: "Abonnements" },
  { href: "/super-admin/plans", label: "Plans" },
  { href: "/super-admin/payments", label: "Paiements" },
  { href: "/super-admin/invoices", label: "Factures" },
  { href: "/super-admin/notifications", label: "Notifications" },
  { href: "/super-admin/logs", label: "Logs" },
  { href: "/super-admin/audit", label: "Audit" },
  { href: "/super-admin/settings", label: "Paramètres plateforme" },
];
