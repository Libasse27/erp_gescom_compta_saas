import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { InvitationsService } from "./invitations.service";
import { UsersController } from "./users.controller";

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [InvitationsService, PermissionsGuard],
})
export class UsersModule {}
