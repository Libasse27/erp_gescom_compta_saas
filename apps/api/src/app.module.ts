import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditLogModule } from "./common/audit/audit-log.module";
import { AuthModule } from "./auth/auth.module";
import { GLOBAL_RATE_LIMIT } from "./common/rate-limit";

@Module({
  imports: [
    // Limite globale par défaut ; /auth/* applique une limite plus stricte
    // via @Throttle (CLAUDE.md §6).
    ThrottlerModule.forRoot([GLOBAL_RATE_LIMIT]),
    PrismaModule,
    AuditLogModule,
    AuthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
