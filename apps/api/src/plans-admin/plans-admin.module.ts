import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PlansAdminController } from "./plans-admin.controller";
import { PlansAdminService } from "./plans-admin.service";
import { PlansAdminRepository } from "./plans-admin.repository";

@Module({
  imports: [AuthModule],
  controllers: [PlansAdminController],
  providers: [PlansAdminService, PlansAdminRepository],
})
export class PlansAdminModule {}
