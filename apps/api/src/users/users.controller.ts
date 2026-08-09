import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { acceptInvitationSchema, inviteUserSchema } from "@erp/validation";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/types";
import { WithinLimit } from "../entitlements/decorators/within-limit.decorator";
import { LimitGuard } from "../entitlements/guards/limit.guard";
import { SubscriptionAccessGuard } from "../entitlements/guards/subscription-access.guard";
import { InvitationsService } from "./invitations.service";
import { UsersService } from "./users.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

@Controller("users")
export class UsersController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly usersService: UsersService,
  ) {}

  // Pilote le menu frontend (Rôle × Permissions × Plan) — n'importe quel
  // utilisateur authentifié d'une entreprise peut lire ses propres droits,
  // aucune permission spécifique requise (docs/PROMPT-MAITRE-SAAS.md Phase 7.2).
  @Get("me/context")
  @UseGuards(JwtAuthGuard)
  getMyContext(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMyContext(user.id, user.enterpriseId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission("users.manage")
  list() {
    return this.usersService.listEnterpriseUsers();
  }

  @Post("invite")
  @UseGuards(JwtAuthGuard, PermissionsGuard, SubscriptionAccessGuard, LimitGuard)
  @RequirePermission("users.manage")
  @WithinLimit("users")
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
