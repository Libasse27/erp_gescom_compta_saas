import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { createSaleSchema, CreateSaleInput, listSalesQuerySchema, ListSalesQuery } from "@erp/validation";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/types";
import { RequiresFeature } from "../entitlements/decorators/requires-feature.decorator";
import { FeatureGuard } from "../entitlements/guards/feature.guard";
import { SubscriptionAccessGuard } from "../entitlements/guards/subscription-access.guard";
import { SalesService } from "./sales.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// Pas de PATCH/DELETE : les lignes sont immuables après création (voir
// schema.prisma, model SaleLine). confirm/cancel sont les seules
// transitions d'état possibles, mappées sur sales.update/sales.delete —
// même patron que la désactivation logique de ProductsController mappée
// sur products.delete.
@Controller("sales")
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  @RequirePermission("sales.read")
  @RequiresFeature("sales")
  list(
    @Query(new ZodValidationPipe(listSalesQuerySchema)) query: ListSalesQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.salesService.list(user.enterpriseId as string, query);
  }

  @Get(":id")
  @RequirePermission("sales.read")
  @RequiresFeature("sales")
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.salesService.get(user.enterpriseId as string, id);
  }

  @Post()
  @RequirePermission("sales.create")
  @RequiresFeature("sales")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createSaleSchema)) body: CreateSaleInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.salesService.create(user.enterpriseId as string, user.id, body, requestMeta(req));
  }

  @Post(":id/confirm")
  @RequirePermission("sales.update")
  @RequiresFeature("sales")
  confirm(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.salesService.confirm(user.enterpriseId as string, user.id, id, requestMeta(req));
  }

  @Post(":id/cancel")
  @RequirePermission("sales.delete")
  @RequiresFeature("sales")
  cancel(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.salesService.cancel(user.enterpriseId as string, user.id, id, requestMeta(req));
  }
}
