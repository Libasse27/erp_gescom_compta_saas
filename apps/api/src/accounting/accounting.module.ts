import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { AccountsController } from "./accounts.controller";
import { AccountsRepository } from "./accounts.repository";
import { AccountsService } from "./accounts.service";
import { JournalController } from "./journal.controller";
import { JournalRepository } from "./journal.repository";
import { JournalService } from "./journal.service";
import { TrialBalanceController } from "./trial-balance.controller";

@Module({
  imports: [AuthModule],
  controllers: [AccountsController, JournalController, TrialBalanceController],
  providers: [AccountsRepository, AccountsService, JournalRepository, JournalService, PermissionsGuard],
})
export class AccountingModule {}
