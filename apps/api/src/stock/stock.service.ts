import { Injectable } from "@nestjs/common";
import { CreateStockMovementInput, ListStockMovementsQuery, ListStockQuery } from "@erp/validation";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import {
  CreateMovementResult,
  StockLevel,
  StockLevelListResult,
  StockMovementListResult,
  StockRepository,
} from "./stock.repository";

@Injectable()
export class StockService {
  constructor(
    private readonly stockRepository: StockRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  listLevels(enterpriseId: string, query: ListStockQuery): Promise<StockLevelListResult> {
    return this.stockRepository.findLevels(enterpriseId, query);
  }

  getLevel(enterpriseId: string, productId: string): Promise<StockLevel> {
    return this.stockRepository.getLevel(enterpriseId, productId);
  }

  listMovements(
    enterpriseId: string,
    productId: string,
    query: ListStockMovementsQuery,
  ): Promise<StockMovementListResult> {
    return this.stockRepository.findMovements(enterpriseId, productId, query);
  }

  async createMovement(
    enterpriseId: string,
    userId: string,
    input: CreateStockMovementInput,
    meta: RequestMetadata,
    idempotencyKey?: string,
  ): Promise<CreateMovementResult> {
    const result = await this.stockRepository.createMovement(enterpriseId, input, idempotencyKey);

    // Un rejeu dédupliqué (docs/adr/0019-...) n'a produit aucune écriture.
    if (result.created) {
      await this.auditLog.record({
        userId,
        enterpriseId,
        action: "CREATE_STOCK_MOVEMENT",
        resource: "StockMovement",
        resourceId: result.movement.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { productId: input.productId, type: input.type, quantity: input.quantity },
      });
    }

    return result;
  }
}
