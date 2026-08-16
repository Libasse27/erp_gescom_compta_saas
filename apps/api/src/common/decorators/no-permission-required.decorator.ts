import { SetMetadata } from "@nestjs/common";

export const NO_PERMISSION_REQUIRED_KEY = "no_permission_required";

// Corrige RBAC-01 (docs/audit/RBAC-AUDIT.md) : PermissionsGuard refuse par
// défaut toute route qui ne déclare ni @RequirePermission ni ce marqueur.
// Réservé aux routes dont l'absence de permission est un choix explicite et
// documenté (ex. lecture de son propre contexte utilisateur) — jamais un
// simple oubli.
export const NoPermissionRequired = () => SetMetadata(NO_PERMISSION_REQUIRED_KEY, true);
