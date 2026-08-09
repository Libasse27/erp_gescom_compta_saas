import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

@Module({
  imports: [AuthModule],
  controllers: [SettingsController],
  providers: [SettingsService, PermissionsGuard],
})
export class SettingsModule {}
