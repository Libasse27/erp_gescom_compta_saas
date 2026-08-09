import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { acceptInvitationSchema, inviteUserSchema } from "@erp/validation";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/types";
import { InvitationsService } from "./invitations.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

@Controller("users")
export class UsersController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post("invite")
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("users.manage")
  @HttpCode(HttpStatus.CREATED)
  invite(
    @Body(new ZodValidationPipe(inviteUserSchema))
    body: { email: string; firstName: string; lastName: string; roleId: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    // user.enterpriseId est garanti non-null ici : PermissionsGuard rejette
    // toute requête d'un utilisateur sans entreprise avant d'atteindre ce code.
    return this.invitationsService.invite(user.enterpriseId as string, body, requestMeta(req));
  }

  @Post("accept-invitation")
  @HttpCode(HttpStatus.OK)
  acceptInvitation(
    @Body(new ZodValidationPipe(acceptInvitationSchema)) body: { token: string; password: string },
    @Req() req: Request,
  ) {
    return this.invitationsService.acceptInvitation(body.token, body.password, requestMeta(req));
  }
}
