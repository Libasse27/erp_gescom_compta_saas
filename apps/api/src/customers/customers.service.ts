import { Injectable } from "@nestjs/common";
import { Customer } from "@prisma/client";
import { CreateCustomerInput, ListCustomersQuery, UpdateCustomerInput } from "@erp/validation";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import { CustomersRepository, CustomerListResult } from "./customers.repository";

@Injectable()
export class CustomersService {
  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  list(enterpriseId: string, query: ListCustomersQuery): Promise<CustomerListResult> {
    return this.customersRepository.findMany(enterpriseId, query);
  }

  get(enterpriseId: string, id: string): Promise<Customer> {
    return this.customersRepository.findByIdOrThrow(enterpriseId, id);
  }

  async create(
    enterpriseId: string,
    userId: string,
    input: CreateCustomerInput,
    meta: RequestMetadata,
  ): Promise<Customer> {
    const customer = await this.customersRepository.create(enterpriseId, input);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "CREATE_CUSTOMER",
      resource: "Customer",
      resourceId: customer.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return customer;
  }

  async update(
    enterpriseId: string,
    userId: string,
    id: string,
    input: UpdateCustomerInput,
    meta: RequestMetadata,
  ): Promise<Customer> {
    const customer = await this.customersRepository.update(enterpriseId, id, input);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "UPDATE_CUSTOMER",
      resource: "Customer",
      resourceId: customer.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return customer;
  }

  async deactivate(enterpriseId: string, userId: string, id: string, meta: RequestMetadata): Promise<Customer> {
    const customer = await this.customersRepository.deactivate(enterpriseId, id);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "DELETE_CLIENT",
      resource: "Customer",
      resourceId: customer.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return customer;
  }
}
