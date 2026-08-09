import { SetMetadata } from "@nestjs/common";
import { PermissionKey } from "@erp/permissions";

export const REQUIRED_PERMISSION_KEY = "required_permission";

// Consommé par PermissionsGuard. Le typage PermissionKey (packages/permissions)
// empêche de référencer une permission qui n'existe pas dans le catalogue.
export const RequirePermission = (permission: PermissionKey) => SetMetadata(REQUIRED_PERMISSION_KEY, permission);
