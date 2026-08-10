import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { StockModule } from "../stock/stock.module";
import { PurchasesController } from "./purchases.controller";
import { PurchasesRepository } from "./purchases.repository";
import { PurchasesService } from "./purchases.service";

@Module({
  imports: [AuthModule, StockModule],
  controllers: [PurchasesController],
  providers: [PurchasesRepository, PurchasesService, PermissionsGuard],
})
export class PurchasesModule {}
