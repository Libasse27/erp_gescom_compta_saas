import { Injectable } from "@nestjs/common";
import { AuditAction, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export interface RecordAuditLogParams {
  userId?: string;
  enterpriseId?: string;
  action: AuditAction;
  resource: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
}

// Append-only : aucune méthode update/delete n'est exposée (CLAUDE.md §6).
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: RecordAuditLogParams): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: params.userId,
        enterpriseId: params.enterpriseId,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        metadata: params.metadata,
      },
    });
  }
}
