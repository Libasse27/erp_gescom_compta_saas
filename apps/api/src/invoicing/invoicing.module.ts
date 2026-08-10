import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { InvoicingController } from "./invoicing.controller";
import { InvoicingRepository } from "./invoicing.repository";
import { InvoicingService } from "./invoicing.service";

@Module({
  imports: [AuthModule],
  controllers: [InvoicingController],
  providers: [InvoicingRepository, InvoicingService, PermissionsGuard],
})
export class InvoicingModule {}
