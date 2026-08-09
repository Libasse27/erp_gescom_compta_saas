import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ProvisioningController } from "./provisioning.controller";
import { ProvisioningService } from "./provisioning.service";

@Module({
  imports: [AuthModule],
  controllers: [ProvisioningController],
  providers: [ProvisioningService],
})
export class ProvisioningModule {}
