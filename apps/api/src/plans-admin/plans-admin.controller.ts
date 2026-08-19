import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import {
  createPlanSchema,
  CreatePlanInput,
  updatePlanSchema,
  UpdatePlanInput,
  setPlanFeatureSchema,
  SetPlanFeatureInput,
  setPlanLimitSchema,
  SetPlanLimitInput,
} from "@erp/validation";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { AuthenticatedUser } from "../auth/types";
import { PlansAdminService } from "./plans-admin.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// Corrige BIL-12 (docs/audit/BILLING-AUDIT.md). Distinct de PlansController
// (`GET /plans`, public, non authentifié, uniquement les plans actifs) :
// ici réservé au Super Admin, expose aussi les plans inactifs et les
// opérations d'écriture. JwtAuthGuard puis SuperAdminGuard, explicitement
// dans cet ordre (le second dépend de request.user posé par le premier).
@Controller("admin/plans")
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class PlansAdminController {
  constructor(private readonly plansAdminService: PlansAdminService) {}

  @Get()
  list() {
    return this.plansAdminService.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createPlanSchema)) body: CreatePlanInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.plansAdminService.create(user.id, body, requestMeta(req));
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) body: UpdatePlanInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.plansAdminService.update(user.id, id, body, requestMeta(req));
  }

  @Put(":id/features/:featureKey")
  setFeature(
    @Param("id") id: string,
    @Param("featureKey") featureKey: string,
    @Body(new ZodValidationPipe(setPlanFeatureSchema)) body: SetPlanFeatureInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.plansAdminService.setFeature(user.id, id, featureKey, body.enabled, requestMeta(req));
  }

  @Put(":id/limits/:limitKey")
  setLimit(
    @Param("id") id: string,
    @Param("limitKey") limitKey: string,
    @Body(new ZodValidationPipe(setPlanLimitSchema)) body: SetPlanLimitInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.plansAdminService.setLimit(user.id, id, limitKey, body.value, requestMeta(req));
  }
}
