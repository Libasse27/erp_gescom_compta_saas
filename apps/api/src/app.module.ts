import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditLogModule } from "./common/audit/audit-log.module";
import { AuthModule } from "./auth/auth.module";
import { CustomersModule } from "./customers/customers.module";
import { EntitlementsModule } from "./entitlements/entitlements.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { PaymentsModule } from "./payments/payments.module";
import { PlansModule } from "./plans/plans.module";
import { ProvisioningModule } from "./provisioning/provisioning.module";
import { RolesModule } from "./roles/roles.module";
import { SettingsModule } from "./settings/settings.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { SuperAdminModule } from "./super-admin/super-admin.module";
import { SuppliersModule } from "./suppliers/suppliers.module";
import { TenantModule } from "./tenant/tenant.module";
import { TenantContextMiddleware } from "./tenant/tenant-context.middleware";
import { UsersModule } from "./users/users.module";
import { GLOBAL_RATE_LIMIT } from "./common/rate-limit";

@Module({
  imports: [
    // Limite globale par défaut ; /auth/* applique une limite plus stricte
    // via @Throttle (CLAUDE.md §6).
    ThrottlerModule.forRoot([GLOBAL_RATE_LIMIT]),
    PrismaModule,
    AuditLogModule,
    NotificationsModule,
    AuthModule,
    TenantModule,
    EntitlementsModule,
    UsersModule,
    SubscriptionsModule,
    PaymentsModule,
    ProvisioningModule,
    PlansModule,
    RolesModule,
    SettingsModule,
    SuperAdminModule,
    OnboardingModule,
    CustomersModule,
    SuppliersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Doit s'exécuter avant tous les guards (voir tenant-context.middleware.ts).
    consumer.apply(TenantContextMiddleware).forRoutes("*");
  }
}
