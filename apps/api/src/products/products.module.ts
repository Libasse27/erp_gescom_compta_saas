import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { ProductsController } from "./products.controller";
import { ProductsRepository } from "./products.repository";
import { ProductsService } from "./products.service";

@Module({
  imports: [AuthModule],
  controllers: [ProductsController],
  providers: [ProductsRepository, ProductsService, PermissionsGuard],
})
export class ProductsModule {}
