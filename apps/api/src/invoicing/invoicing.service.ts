import { Injectable } from "@nestjs/common";
import { CreateSalesInvoiceInput, ListSalesInvoicesQuery } from "@erp/validation";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import { InvoicingRepository, SalesInvoiceListResult, SalesInvoiceView } from "./invoicing.repository";

@Injectable()
export class InvoicingService {
  constructor(
    private readonly invoicingRepository: InvoicingRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  list(enterpriseId: string, query: ListSalesInvoicesQuery): Promise<SalesInvoiceListResult> {
    return this.invoicingRepository.findMany(enterpriseId, query);
  }

  get(enterpriseId: string, id: string): Promise<SalesInvoiceView> {
    return this.invoicingRepository.findByIdOrThrow(enterpriseId, id);
  }

  async create(
    enterpriseId: string,
    userId: string,
    input: CreateSalesInvoiceInput,
    meta: RequestMetadata,
  ): Promise<SalesInvoiceView> {
    const invoice = await this.invoicingRepository.create(enterpriseId, input);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "CREATE_INVOICE",
      resource: "SalesInvoice",
      resourceId: invoice.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return invoice;
  }

  async markPaid(enterpriseId: string, userId: string, id: string, meta: RequestMetadata): Promise<SalesInvoiceView> {
    const invoice = await this.invoicingRepository.markPaid(enterpriseId, id);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "MARK_INVOICE_PAID",
      resource: "SalesInvoice",
      resourceId: invoice.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return invoice;
  }

  async void(enterpriseId: string, userId: string, id: string, meta: RequestMetadata): Promise<SalesInvoiceView> {
    const invoice = await this.invoicingRepository.void(enterpriseId, id);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "VOID_INVOICE",
      resource: "SalesInvoice",
      resourceId: invoice.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return invoice;
  }
}
