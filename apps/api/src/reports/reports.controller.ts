import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { reportPeriodQuerySchema, ReportPeriodQuery } from "@erp/validation";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/types";
import { RequiresFeature } from "../entitlements/decorators/requires-feature.decorator";
import { FeatureGuard } from "../entitlements/guards/feature.guard";
import { SubscriptionAccessGuard } from "../entitlements/guards/subscription-access.guard";
import { ReportsService } from "./reports.service";

// Module 9 (dernier) de la Phase 8 : lecture seule, une seule permission
// (reports.read, aucune reports.create/update/delete dans le catalogue) sur
// les trois routes.
@Controller("reports")
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("sales")
  @RequirePermission("reports.read")
  @RequiresFeature("reports")
  salesReport(
    @Query(new ZodValidationPipe(reportPeriodQuerySchema)) query: ReportPeriodQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reportsService.salesReport(user.enterpriseId as string, query);
  }

  @Get("purchases")
  @RequirePermission("reports.read")
  @RequiresFeature("reports")
  purchasesReport(
    @Query(new ZodValidationPipe(reportPeriodQuerySchema)) query: ReportPeriodQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reportsService.purchasesReport(user.enterpriseId as string, query);
  }

  @Get("income-statement")
  @RequirePermission("reports.read")
  @RequiresFeature("reports")
  incomeStatement(
    @Query(new ZodValidationPipe(reportPeriodQuerySchema)) query: ReportPeriodQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reportsService.incomeStatement(user.enterpriseId as string, query);
  }
}
