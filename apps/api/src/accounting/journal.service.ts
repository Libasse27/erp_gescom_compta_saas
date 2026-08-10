import { Injectable } from "@nestjs/common";
import { CreateJournalEntryInput, ListJournalEntriesQuery } from "@erp/validation";
import { AuditLogService } from "../common/audit/audit-log.service";
import { RequestMetadata } from "../auth/auth.service";
import { JournalEntryListResult, JournalEntryView, JournalRepository } from "./journal.repository";

@Injectable()
export class JournalService {
  constructor(
    private readonly journalRepository: JournalRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  list(enterpriseId: string, query: ListJournalEntriesQuery): Promise<JournalEntryListResult> {
    return this.journalRepository.findMany(enterpriseId, query);
  }

  get(enterpriseId: string, id: string): Promise<JournalEntryView> {
    return this.journalRepository.findByIdOrThrow(enterpriseId, id);
  }

  async create(
    enterpriseId: string,
    userId: string,
    input: CreateJournalEntryInput,
    meta: RequestMetadata,
  ): Promise<JournalEntryView> {
    const entry = await this.journalRepository.create(enterpriseId, input);

    await this.auditLog.record({
      userId,
      enterpriseId,
      action: "CREATE_JOURNAL_ENTRY",
      resource: "JournalEntry",
      resourceId: entry.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return entry;
  }
}
