import { SetMetadata } from "@nestjs/common";

export const REQUIRED_FEATURE_KEY = "required_feature";

// Consommé par FeatureGuard. La clé n'est pas typée en dur (contrairement à
// PermissionKey) : le catalogue de features vit en base, éditable par le
// Super Admin (docs/adr/0005-stockage-entitlements.md), pas dans le code.
export const RequiresFeature = (featureKey: string) => SetMetadata(REQUIRED_FEATURE_KEY, featureKey);
