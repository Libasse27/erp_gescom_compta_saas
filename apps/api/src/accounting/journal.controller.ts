import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import {
  createJournalEntrySchema,
  CreateJournalEntryInput,
  listJournalEntriesQuerySchema,
  ListJournalEntriesQuery,
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
import { JournalService } from "./journal.service";

function requestMeta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

// Module 8 de la Phase 8, comme StockController : pas de PATCH/DELETE,
// create() est la seule écriture — une correction se fait par une nouvelle
// écriture de contre-passation, jamais en modifiant l'historique.
@Controller("accounting/journal-entries")
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard)
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Get()
  @RequirePermission("accounting.read")
  @RequiresFeature("accounting")
  list(
    @Query(new ZodValidationPipe(listJournalEntriesQuerySchema)) query: ListJournalEntriesQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.journalService.list(user.enterpriseId as string, query);
  }

  @Get(":id")
  @RequirePermission("accounting.read")
  @RequiresFeature("accounting")
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.journalService.get(user.enterpriseId as string, id);
  }

  @Post()
  @RequirePermission("accounting.create")
  @RequiresFeature("accounting")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createJournalEntrySchema)) body: CreateJournalEntryInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.journalService.create(user.enterpriseId as string, user.id, body, requestMeta(req));
  }
}
