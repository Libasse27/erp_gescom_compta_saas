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

  // tx optionnel (BIL-10, docs/audit/BILLING-AUDIT.md) : permet à un
  // appelant déjà dans une transaction Prisma (ex. provisioning.service.ts)
  // d'y inclure cette écriture d'audit pour qu'elle soit atomique avec le
  // reste — jamais possible de créer l'entité sans son entrée d'audit.
  // Défaut this.prisma (connexion identité) : tous les appels existants,
  // qui n'en passent pas, sont inchangés.
  async record(params: RecordAuditLogParams, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.prisma).auditLog.create({
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
