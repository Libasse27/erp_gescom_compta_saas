import { Controller, Get, UseGuards } from "@nestjs/common";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../auth/types";
import { RequiresFeature } from "../entitlements/decorators/requires-feature.decorator";
import { FeatureGuard } from "../entitlements/guards/feature.guard";
import { SubscriptionAccessGuard } from "../entitlements/guards/subscription-access.guard";
import { AccountsService } from "./accounts.service";

// Route dédiée plutôt qu'un paramètre sur GET /accounting/accounts : la
// balance des comptes n'est jamais paginée (voir AccountsRepository.trialBalance),
// une forme de réponse différente de la liste standard.
@Controller("accounting")
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard, SubscriptionAccessGuard)
export class TrialBalanceController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get("trial-balance")
  @RequirePermission("accounting.read")
  @RequiresFeature("accounting")
  trialBalance(@CurrentUser() user: AuthenticatedUser) {
    return this.accountsService.trialBalance(user.enterpriseId as string);
  }
}
