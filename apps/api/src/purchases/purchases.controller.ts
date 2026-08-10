import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { createPurchaseSchema, CreatePurchaseInput, listPurchasesQuerySchema, ListPurchasesQuery } from "@erp/validation";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/types";
import { RequiresFeature } from "../entitlements/decorators/requires-feature.decorator";
import { FeatureGuard } from "../entitlements/guards/feature.guard";
import { SubscriptionAccessGuard } from "../entitlements/guards/subscription-access.guard";
import { PurchasesService } from "./purchases.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// Module 6 de la Phase 8, miroir de SalesController : pas de PATCH/DELETE,
// confirm/cancel sont les seules transitions d'état, mappées sur
// purchases.update/purchases.delete.
@Controller("purchases")
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get()
  @RequirePermission("purchases.read")
  @RequiresFeature("purchases")
  list(
    @Query(new ZodValidationPipe(listPurchasesQuerySchema)) query: ListPurchasesQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.purchasesService.list(user.enterpriseId as string, query);
  }

  @Get(":id")
  @RequirePermission("purchases.read")
  @RequiresFeature("purchases")
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.purchasesService.get(user.enterpriseId as string, id);
  }

  @Post()
  @RequirePermission("purchases.create")
  @RequiresFeature("purchases")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createPurchaseSchema)) body: CreatePurchaseInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.purchasesService.create(user.enterpriseId as string, user.id, body, requestMeta(req));
  }

  @Post(":id/confirm")
  @RequirePermission("purchases.update")
  @RequiresFeature("purchases")
  confirm(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.purchasesService.confirm(user.enterpriseId as string, user.id, id, requestMeta(req));
  }

  @Post(":id/cancel")
  @RequirePermission("purchases.delete")
  @RequiresFeature("purchases")
  cancel(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.purchasesService.cancel(user.enterpriseId as string, user.id, id, requestMeta(req));
  }
}
