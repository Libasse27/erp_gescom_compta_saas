import { Injectable } from "@nestjs/common";
import { CreateAccountInput, ListAccountsQuery, UpdateAccountInput } from "@erp/validation";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import { AccountListResult, AccountsRepository, AccountView, TrialBalanceView } from "./accounts.repository";

@Injectable()
export class AccountsService {
  constructor(
    private readonly accountsRepository: AccountsRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  list(enterpriseId: string, query: ListAccountsQuery): Promise<AccountListResult> {
    return this.accountsRepository.findMany(enterpriseId, query);
  }

  get(enterpriseId: string, id: string): Promise<AccountView> {
    return this.accountsRepository.findByIdOrThrow(enterpriseId, id);
  }

  trialBalance(enterpriseId: string): Promise<TrialBalanceView> {
    return this.accountsRepository.trialBalance(enterpriseId);
  }

  async create(
    enterpriseId: string,
    userId: string,
    input: CreateAccountInput,
    meta: RequestMetadata,
  ): Promise<AccountView> {
    const account = await this.accountsRepository.create(enterpriseId, input);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "CREATE_ACCOUNT",
      resource: "Account",
      resourceId: account.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return account;
  }

  async update(
    enterpriseId: string,
    userId: string,
    id: string,
    input: UpdateAccountInput,
    meta: RequestMetadata,
  ): Promise<AccountView> {
    const account = await this.accountsRepository.update(enterpriseId, id, input);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "UPDATE_ACCOUNT",
      resource: "Account",
      resourceId: account.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return account;
  }
}
