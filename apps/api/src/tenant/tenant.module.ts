import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CrossTenantRepository } from "./cross-tenant.repository";
import { TenantContextMiddleware } from "./tenant-context.middleware";
import { TenantScopedPrismaService } from "./tenant-scoped-prisma.service";

@Global()
@Module({
  imports: [AuthModule],
  providers: [TenantContextMiddleware, TenantScopedPrismaService, CrossTenantRepository],
  exports: [TenantContextMiddleware, TenantScopedPrismaService, CrossTenantRepository],
})
export class TenantModule {}
