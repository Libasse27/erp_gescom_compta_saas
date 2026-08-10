import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import {
  createProductSchema,
  CreateProductInput,
  listProductsQuerySchema,
  ListProductsQuery,
  updateProductSchema,
  UpdateProductInput,
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
import { ProductsService } from "./products.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// FeatureGuard lit ses métadonnées via context.getHandler() (voir
// feature.guard.ts) : @RequiresFeature doit donc être répété sur chaque
// méthode, comme @RequirePermission — un décorateur de classe ne serait pas
// vu par ce guard. Posé sur les 5 routes (pas seulement les écritures) : un
// plan sans la feature "products" ne doit pas non plus pouvoir
// lister/consulter (docs/PROMPT-MAITRE-SAAS.md Phase 4).
@Controller("products")
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @RequirePermission("products.read")
  @RequiresFeature("products")
  list(
    @Query(new ZodValidationPipe(listProductsQuerySchema)) query: ListProductsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.productsService.list(user.enterpriseId as string, query);
  }

  @Get(":id")
  @RequirePermission("products.read")
  @RequiresFeature("products")
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.productsService.get(user.enterpriseId as string, id);
  }

  @Post()
  @RequirePermission("products.create")
  @RequiresFeature("products")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.productsService.create(user.enterpriseId as string, user.id, body, requestMeta(req));
  }

  @Patch(":id")
  @RequirePermission("products.update")
  @RequiresFeature("products")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.productsService.update(user.enterpriseId as string, user.id, id, body, requestMeta(req));
  }

  @Delete(":id")
  @RequirePermission("products.delete")
  @RequiresFeature("products")
  @HttpCode(HttpStatus.OK)
  deactivate(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.productsService.deactivate(user.enterpriseId as string, user.id, id, requestMeta(req));
  }
}
