import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import {
  createAccountSchema,
  CreateAccountInput,
  listAccountsQuerySchema,
  ListAccountsQuery,
  updateAccountSchema,
  UpdateAccountInput,
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
import { AccountsService } from "./accounts.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// Module 8 de la Phase 8. Pas de DELETE : aucune clé "accounting.delete"
// dans le catalogue (packages/permissions) — un compte référencé par des
// écritures append-only ne doit jamais disparaître.
@Controller("accounting/accounts")
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  @RequirePermission("accounting.read")
  @RequiresFeature("accounting")
  list(
    @Query(new ZodValidationPipe(listAccountsQuerySchema)) query: ListAccountsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accountsService.list(user.enterpriseId as string, query);
  }

  @Get(":id")
  @RequirePermission("accounting.read")
  @RequiresFeature("accounting")
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.get(user.enterpriseId as string, id);
  }

  @Post()
  @RequirePermission("accounting.create")
  @RequiresFeature("accounting")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createAccountSchema)) body: CreateAccountInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.accountsService.create(user.enterpriseId as string, user.id, body, requestMeta(req));
  }

  @Patch(":id")
  @RequirePermission("accounting.update")
  @RequiresFeature("accounting")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAccountSchema)) body: UpdateAccountInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.accountsService.update(user.enterpriseId as string, user.id, id, body, requestMeta(req));
  }
}
