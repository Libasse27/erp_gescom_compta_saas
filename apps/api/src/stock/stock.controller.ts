import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import {
  createStockMovementSchema,
  CreateStockMovementInput,
  listStockMovementsQuerySchema,
  ListStockMovementsQuery,
  listStockQuerySchema,
  ListStockQuery,
} from "@erp/validation";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/types";
import { RequiresFeature } from "../entitlements/decorators/requires-feature.decorator";
import { FeatureGuard } from "../entitlements/guards/feature.guard";
import { SubscriptionAccessGuard } from "../entitlements/guards/subscription-access.guard";
import { StockService } from "./stock.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// Contrairement à ProductsController (une fiche), pas de PATCH/DELETE ici :
// StockMovement est un grand livre append-only (voir schema.prisma), une
// correction se fait via un nouveau mouvement ADJUSTMENT.
@Controller("stock")
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  @RequirePermission("stock.read")
  @RequiresFeature("stock")
  listLevels(
    @Query(new ZodValidationPipe(listStockQuerySchema)) query: ListStockQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stockService.listLevels(user.enterpriseId as string, query);
  }

  @Get(":productId")
  @RequirePermission("stock.read")
  @RequiresFeature("stock")
  getLevel(@Param("productId") productId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.stockService.getLevel(user.enterpriseId as string, productId);
  }

  @Get(":productId/movements")
  @RequirePermission("stock.read")
  @RequiresFeature("stock")
  listMovements(
    @Param("productId") productId: string,
    @Query(new ZodValidationPipe(listStockMovementsQuerySchema)) query: ListStockMovementsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.stockService.listMovements(user.enterpriseId as string, productId, query);
  }

  @Post("movements")
  @RequirePermission("stock.create")
  @RequiresFeature("stock")
  @HttpCode(HttpStatus.CREATED)
  createMovement(
    @Body(new ZodValidationPipe(createStockMovementSchema)) body: CreateStockMovementInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    // Corrige ERP-AUDIT-001 (docs/adr/0019-...).
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.stockService.createMovement(user.enterpriseId as string, user.id, body, requestMeta(req), idempotencyKey);
  }
}
