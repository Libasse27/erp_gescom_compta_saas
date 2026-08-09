import { Global, Module } from "@nestjs/common";
import { EntitlementsService } from "./entitlements.service";
import { FeatureGuard } from "./guards/feature.guard";
import { LimitGuard } from "./guards/limit.guard";
import { SubscriptionAccessGuard } from "./guards/subscription-access.guard";

// Global comme TenantModule/AuditLogModule : EntitlementsService et les
// guards sont utilisables depuis n'importe quel module métier (Phase 8) sans
// réimporter ce module partout.
@Global()
@Module({
  providers: [EntitlementsService, FeatureGuard, LimitGuard, SubscriptionAccessGuard],
  exports: [EntitlementsService, FeatureGuard, LimitGuard, SubscriptionAccessGuard],
})
export class EntitlementsModule {}
