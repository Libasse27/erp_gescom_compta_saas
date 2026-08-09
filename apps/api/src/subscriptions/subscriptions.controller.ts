import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { changeSubscriptionPlanSchema } from "@erp/validation";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { AuthenticatedUser } from "../auth/types";
import { SubscriptionsService } from "./subscriptions.service";

// Route plateforme (pas d'espace tenant) : accessible uniquement au Super
// Admin, qui gère ainsi toutes les entreprises (docs/SPECIFICATIONS-SAAS.md
// §4.1). L'interface Super Admin dédiée arrive en Phase 7 ; ce endpoint est
// le point d'entrée API requis dès maintenant pour la Phase 4.
@Controller("admin/enterprises/:enterpriseId/subscription")
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Patch()
  @HttpCode(HttpStatus.OK)
  changePlan(
    @Param("enterpriseId", new ParseUUIDPipe()) enterpriseId: string,
    @Body(new ZodValidationPipe(changeSubscriptionPlanSchema)) body: { planId: string; reason?: string },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.subscriptionsService.changePlan(enterpriseId, body.planId, user.id, body.reason, {
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }
}
