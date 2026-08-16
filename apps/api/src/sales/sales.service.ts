import { Injectable } from "@nestjs/common";
import { CreateSaleInput, ListSalesQuery } from "@erp/validation";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import { SaleListResult, SalesRepository, SaleView } from "./sales.repository";

@Injectable()
export class SalesService {
  constructor(
    private readonly salesRepository: SalesRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  list(enterpriseId: string, query: ListSalesQuery): Promise<SaleListResult> {
    return this.salesRepository.findMany(enterpriseId, query);
  }

  get(enterpriseId: string, id: string): Promise<SaleView> {
    return this.salesRepository.findByIdOrThrow(enterpriseId, id);
  }

  async create(
    enterpriseId: string,
    userId: string,
    input: CreateSaleInput,
    meta: RequestMetadata,
    idempotencyKey?: string,
  ): Promise<SaleView> {
    const { view: sale, created } = await this.salesRepository.create(enterpriseId, input, idempotencyKey);

    // Un rejeu dédupliqué (docs/adr/0019-...) n'a produit aucune écriture :
    // pas de nouvelle entrée d'audit log pour une création qui n'a pas eu lieu.
    if (created) {
      await this.auditLog.record({
        userId,
        enterpriseId,
        action: "CREATE_SALE",
        resource: "Sale",
        resourceId: sale.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }

    return sale;
  }

  async confirm(enterpriseId: string, userId: string, id: string, meta: RequestMetadata): Promise<SaleView> {
    const sale = await this.salesRepository.confirm(enterpriseId, id);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "CONFIRM_SALE",
      resource: "Sale",
      resourceId: sale.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return sale;
  }

  async cancel(enterpriseId: string, userId: string, id: string, meta: RequestMetadata): Promise<SaleView> {
    const sale = await this.salesRepository.cancel(enterpriseId, id);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "CANCEL_SALE",
      resource: "Sale",
      resourceId: sale.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return sale;
  }
}
