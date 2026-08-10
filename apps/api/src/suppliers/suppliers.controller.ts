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
  createSupplierSchema,
  CreateSupplierInput,
  listSuppliersQuerySchema,
  ListSuppliersQuery,
  updateSupplierSchema,
  UpdateSupplierInput,
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
import { SuppliersService } from "./suppliers.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// FeatureGuard lit ses métadonnées via context.getHandler() (voir
// feature.guard.ts) : @RequiresFeature doit donc être répété sur chaque
// méthode, comme @RequirePermission — un décorateur de classe ne serait pas
// vu par ce guard. Posé sur les 5 routes (pas seulement les écritures) : un
// plan sans la feature "suppliers" ne doit pas non plus pouvoir
// lister/consulter (docs/PROMPT-MAITRE-SAAS.md Phase 4).
@Controller("suppliers")
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @RequirePermission("suppliers.read")
  @RequiresFeature("suppliers")
  list(
    @Query(new ZodValidationPipe(listSuppliersQuerySchema)) query: ListSuppliersQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.suppliersService.list(user.enterpriseId as string, query);
  }

  @Get(":id")
  @RequirePermission("suppliers.read")
  @RequiresFeature("suppliers")
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.suppliersService.get(user.enterpriseId as string, id);
  }

  @Post()
  @RequirePermission("suppliers.create")
  @RequiresFeature("suppliers")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createSupplierSchema)) body: CreateSupplierInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.suppliersService.create(user.enterpriseId as string, user.id, body, requestMeta(req));
  }

  @Patch(":id")
  @RequirePermission("suppliers.update")
  @RequiresFeature("suppliers")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: UpdateSupplierInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.suppliersService.update(user.enterpriseId as string, user.id, id, body, requestMeta(req));
  }

  @Delete(":id")
  @RequirePermission("suppliers.delete")
  @RequiresFeature("suppliers")
  @HttpCode(HttpStatus.OK)
  deactivate(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.suppliersService.deactivate(user.enterpriseId as string, user.id, id, requestMeta(req));
  }
}
