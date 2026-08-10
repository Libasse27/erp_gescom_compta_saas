import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import {
  createSalesInvoiceSchema,
  CreateSalesInvoiceInput,
  listSalesInvoicesQuerySchema,
  ListSalesInvoicesQuery,
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
import { InvoicingService } from "./invoicing.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// Module 7 de la Phase 8, miroir de SalesController/PurchasesController :
// pas de PATCH/DELETE, mark-paid/void sont les seules transitions,
// mappées sur invoicing.update/invoicing.delete. Pas de body sur create en
// dehors de saleId : les lignes viennent de la vente, jamais ressaisies.
@Controller("invoices")
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard)
export class InvoicingController {
  constructor(private readonly invoicingService: InvoicingService) {}

  @Get()
  @RequirePermission("invoicing.read")
  @RequiresFeature("invoicing")
  list(
    @Query(new ZodValidationPipe(listSalesInvoicesQuerySchema)) query: ListSalesInvoicesQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicingService.list(user.enterpriseId as string, query);
  }

  @Get(":id")
  @RequirePermission("invoicing.read")
  @RequiresFeature("invoicing")
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicingService.get(user.enterpriseId as string, id);
  }

  @Post()
  @RequirePermission("invoicing.create")
  @RequiresFeature("invoicing")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createSalesInvoiceSchema)) body: CreateSalesInvoiceInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.invoicingService.create(user.enterpriseId as string, user.id, body, requestMeta(req));
  }

  @Post(":id/mark-paid")
  @RequirePermission("invoicing.update")
  @RequiresFeature("invoicing")
  markPaid(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.invoicingService.markPaid(user.enterpriseId as string, user.id, id, requestMeta(req));
  }

  @Post(":id/void")
  @RequirePermission("invoicing.delete")
  @RequiresFeature("invoicing")
  void(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.invoicingService.void(user.enterpriseId as string, user.id, id, requestMeta(req));
  }
}
