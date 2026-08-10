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
  createCustomerSchema,
  CreateCustomerInput,
  listCustomersQuerySchema,
  ListCustomersQuery,
  updateCustomerSchema,
  UpdateCustomerInput,
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
import { CustomersService } from "./customers.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// FeatureGuard lit ses métadonnées via context.getHandler() (voir
// feature.guard.ts) : @RequiresFeature doit donc être répété sur chaque
// méthode, comme @RequirePermission — un décorateur de classe ne serait pas
// vu par ce guard. Posé sur les 5 routes (pas seulement les écritures) : un
// plan sans la feature "clients" ne doit pas non plus pouvoir lister/consulter
// (docs/PROMPT-MAITRE-SAAS.md Phase 4).
@Controller("customers")
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermission("clients.read")
  @RequiresFeature("clients")
  list(
    @Query(new ZodValidationPipe(listCustomersQuerySchema)) query: ListCustomersQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.customersService.list(user.enterpriseId as string, query);
  }

  @Get(":id")
  @RequirePermission("clients.read")
  @RequiresFeature("clients")
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.customersService.get(user.enterpriseId as string, id);
  }

  @Post()
  @RequirePermission("clients.create")
  @RequiresFeature("clients")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createCustomerSchema)) body: CreateCustomerInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.customersService.create(user.enterpriseId as string, user.id, body, requestMeta(req));
  }

  @Patch(":id")
  @RequirePermission("clients.update")
  @RequiresFeature("clients")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema)) body: UpdateCustomerInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.customersService.update(user.enterpriseId as string, user.id, id, body, requestMeta(req));
  }

  @Delete(":id")
  @RequirePermission("clients.delete")
  @RequiresFeature("clients")
  @HttpCode(HttpStatus.OK)
  deactivate(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.customersService.deactivate(user.enterpriseId as string, user.id, id, requestMeta(req));
  }
}
