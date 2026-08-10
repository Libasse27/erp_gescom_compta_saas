import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { CustomersController } from "./customers.controller";
import { CustomersRepository } from "./customers.repository";
import { CustomersService } from "./customers.service";

@Module({
  imports: [AuthModule],
  controllers: [CustomersController],
  providers: [CustomersRepository, CustomersService, PermissionsGuard],
})
export class CustomersModule {}
