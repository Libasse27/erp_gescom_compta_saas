import { Injectable } from "@nestjs/common";
import { Supplier } from "@prisma/client";
import { CreateSupplierInput, ListSuppliersQuery, UpdateSupplierInput } from "@erp/validation";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import { SuppliersRepository, SupplierListResult } from "./suppliers.repository";

@Injectable()
export class SuppliersService {
  constructor(
    private readonly suppliersRepository: SuppliersRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  list(enterpriseId: string, query: ListSuppliersQuery): Promise<SupplierListResult> {
    return this.suppliersRepository.findMany(enterpriseId, query);
  }

  get(enterpriseId: string, id: string): Promise<Supplier> {
    return this.suppliersRepository.findByIdOrThrow(enterpriseId, id);
  }

  async create(
    enterpriseId: string,
    userId: string,
    input: CreateSupplierInput,
    meta: RequestMetadata,
  ): Promise<Supplier> {
    const supplier = await this.suppliersRepository.create(enterpriseId, input);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "CREATE_SUPPLIER",
      resource: "Supplier",
      resourceId: supplier.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return supplier;
  }

  async update(
    enterpriseId: string,
    userId: string,
    id: string,
    input: UpdateSupplierInput,
    meta: RequestMetadata,
  ): Promise<Supplier> {
    const supplier = await this.suppliersRepository.update(enterpriseId, id, input);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "UPDATE_SUPPLIER",
      resource: "Supplier",
      resourceId: supplier.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return supplier;
  }

  async deactivate(enterpriseId: string, userId: string, id: string, meta: RequestMetadata): Promise<Supplier> {
    const supplier = await this.suppliersRepository.deactivate(enterpriseId, id);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "DELETE_SUPPLIER",
      resource: "Supplier",
      resourceId: supplier.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return supplier;
  }
}
