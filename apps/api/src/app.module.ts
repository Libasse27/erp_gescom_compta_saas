import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { SentryGlobalFilter, SentryModule } from "@sentry/nestjs/setup";
import { PrismaModule } from "./prisma/prisma.module";
import { AccountingModule } from "./accounting/accounting.module";
import { AuditLogModule } from "./common/audit/audit-log.module";
import { AuthModule } from "./auth/auth.module";
import { CustomersModule } from "./customers/customers.module";
import { EntitlementsModule } from "./entitlements/entitlements.module";
import { HealthModule } from "./health/health.module";
import { InvoicingModule } from "./invoicing/invoicing.module";
import { LoggingModule } from "./common/logging/logging.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { PaymentsModule } from "./payments/payments.module";
import { PlansModule } from "./plans/plans.module";
import { ProductsModule } from "./products/products.module";
import { ProvisioningModule } from "./provisioning/provisioning.module";
import { PurchasesModule } from "./purchases/purchases.module";
import { ReportsModule } from "./reports/reports.module";
import { RolesModule } from "./roles/roles.module";
import { SalesModule } from "./sales/sales.module";
import { SettingsModule } from "./settings/settings.module";
import { StockModule } from "./stock/stock.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { SuperAdminModule } from "./super-admin/super-admin.module";
import { SuppliersModule } from "./suppliers/suppliers.module";
import { TenantModule } from "./tenant/tenant.module";
import { TenantContextMiddleware } from "./tenant/tenant-context.middleware";
import { UsersModule } from "./users/users.module";
import { GLOBAL_RATE_LIMIT } from "./common/rate-limit";
import { RequestContextMiddleware } from "./common/logging/request-context.middleware";
import { HttpLoggingMiddleware } from "./common/logging/http-logging.middleware";

@Module({
  imports: [
    // P-08 (docs/audit/PRODUCTION-READINESS.md) : SentryModule doit être le
    // tout premier import (recommandation officielle @sentry/nestjs) — mais
    // n'existe même pas dans le graphe de modules si SENTRY_DSN est absent
    // (désactivé par défaut, voir src/instrument.ts et
    // docs/deployment/MONITORING.md).
    ...(process.env.SENTRY_DSN ? [SentryModule.forRoot()] : []),
    // Limite globale par défaut ; /auth/* applique une limite plus stricte
    // via @Throttle (CLAUDE.md §6).
    ThrottlerModule.forRoot([GLOBAL_RATE_LIMIT]),
    LoggingModule,
    HealthModule,
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
    ProductsModule,
    StockModule,
    SalesModule,
    PurchasesModule,
    InvoicingModule,
    AccountingModule,
    ReportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Rapporte à Sentry les exceptions non gérées puis délègue au filtre
    // Nest par défaut (SentryGlobalFilter étend BaseExceptionFilter) — ne
    // change donc pas la forme des réponses HTTP existantes (400/403/404...),
    // ajoute seulement la capture des erreurs inattendues. Absent du graphe
    // si SENTRY_DSN n'est pas renseigné (même garde que SentryModule ci-dessus).
    ...(process.env.SENTRY_DSN ? [{ provide: APP_FILTER, useClass: SentryGlobalFilter }] : []),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Ordre significatif (Phase 10.5, docs/deployment/LOGGING.md) :
    // 1. RequestContextMiddleware — englobe TOUTE la requête (y compris les
    //    routes publiques) dans son AsyncLocalStorage, doit donc être le
    //    premier maillon de la chaîne.
    // 2. TenantContextMiddleware — doit s'exécuter avant tous les guards
    //    (voir tenant-context.middleware.ts).
    // 3. HttpLoggingMiddleware — enregistre son listener 'finish' en
    //    dernier pour hériter des deux contextes ci-dessus au moment où il
    //    se déclenche (fin de la requête).
    consumer.apply(RequestContextMiddleware).forRoutes("*");
    consumer.apply(TenantContextMiddleware).forRoutes("*");
    consumer.apply(HttpLoggingMiddleware).forRoutes("*");
  }
}
