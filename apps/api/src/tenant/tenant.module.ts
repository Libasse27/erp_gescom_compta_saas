import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TenantContextMiddleware } from "./tenant-context.middleware";
import { TenantScopedPrismaService } from "./tenant-scoped-prisma.service";

@Global()
@Module({
  imports: [AuthModule],
  providers: [TenantContextMiddleware, TenantScopedPrismaService],
  exports: [TenantContextMiddleware, TenantScopedPrismaService],
})
export class TenantModule {}
