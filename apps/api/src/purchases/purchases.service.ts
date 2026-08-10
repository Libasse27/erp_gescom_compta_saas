import { Injectable } from "@nestjs/common";
import { CreatePurchaseInput, ListPurchasesQuery } from "@erp/validation";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import { PurchaseListResult, PurchasesRepository, PurchaseView } from "./purchases.repository";

@Injectable()
export class PurchasesService {
  constructor(
    private readonly purchasesRepository: PurchasesRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  list(enterpriseId: string, query: ListPurchasesQuery): Promise<PurchaseListResult> {
    return this.purchasesRepository.findMany(enterpriseId, query);
  }

  get(enterpriseId: string, id: string): Promise<PurchaseView> {
    return this.purchasesRepository.findByIdOrThrow(enterpriseId, id);
  }

  async create(
    enterpriseId: string,
    userId: string,
    input: CreatePurchaseInput,
    meta: RequestMetadata,
  ): Promise<PurchaseView> {
    const purchase = await this.purchasesRepository.create(enterpriseId, input);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "CREATE_PURCHASE",
      resource: "Purchase",
      resourceId: purchase.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return purchase;
  }

  async confirm(enterpriseId: string, userId: string, id: string, meta: RequestMetadata): Promise<PurchaseView> {
    const purchase = await this.purchasesRepository.confirm(enterpriseId, id);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "CONFIRM_PURCHASE",
      resource: "Purchase",
      resourceId: purchase.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return purchase;
  }

  async cancel(enterpriseId: string, userId: string, id: string, meta: RequestMetadata): Promise<PurchaseView> {
    const purchase = await this.purchasesRepository.cancel(enterpriseId, id);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "CANCEL_PURCHASE",
      resource: "Purchase",
      resourceId: purchase.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return purchase;
  }
}
