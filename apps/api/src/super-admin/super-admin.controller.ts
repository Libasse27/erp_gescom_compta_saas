import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { AuthenticatedUser } from "../auth/types";
import { SuperAdminService } from "./super-admin.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

@Controller("admin")
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  @Get("overview")
  getOverview(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.superAdminService.getOverview(user.id, requestMeta(req));
  }

  @Get("enterprises")
  listEnterprises(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.superAdminService.listEnterprises(user.id, requestMeta(req));
  }

  // Corrige BIL-04 (docs/audit/BILLING-AUDIT.md).
  @Post("enterprises/:id/suspend")
  @HttpCode(HttpStatus.OK)
  suspendEnterprise(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.superAdminService.suspendEnterprise(user.id, id, requestMeta(req));
  }

  @Post("enterprises/:id/reactivate")
  @HttpCode(HttpStatus.OK)
  reactivateEnterprise(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.superAdminService.reactivateEnterprise(user.id, id, requestMeta(req));
  }
}
