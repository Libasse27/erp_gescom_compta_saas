import { Controller, Get, Req, UseGuards } from "@nestjs/common";
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
}
