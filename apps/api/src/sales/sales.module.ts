import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { StockModule } from "../stock/stock.module";
import { SalesController } from "./sales.controller";
import { SalesRepository } from "./sales.repository";
import { SalesService } from "./sales.service";

@Module({
  imports: [AuthModule, StockModule],
  controllers: [SalesController],
  providers: [SalesRepository, SalesService, PermissionsGuard],
})
export class SalesModule {}
