import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CreateJournalEntryInput, ListJournalEntriesQuery } from "@erp/validation";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";

export interface JournalEntryLineView {
  id: string;
  accountId: string;
  accountCode: string;
  accountLabel: string;
  label: string | null;
  debitAmount: number;
  creditAmount: number;
}

// totalDebit === totalCredit toujours (invariant garanti à la création par
// createJournalEntrySchema, jamais recalculé différemment) : les deux
// champs restent explicites plutôt qu'un seul "amount", pour rester lisible
// comme une écriture comptable (même choix que SaleView qui expose HT/TVA/TTC
// séparément malgré la relation arithmétique entre eux).
export interface JournalEntryView {
  id: string;
  enterpriseId: string;
  number: string;
  entryDate: Date;
  reference: string | null;
  description: string;
  totalDebit: number;
  totalCredit: number;
  lines: JournalEntryLineView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface JournalEntryListResult {
  items: JournalEntryView[];
  total: number;
  page: number;
  pageSize: number;
}

// `created: false` signale un rejeu déduplié (docs/adr/0019-...) — même
// patron que CreateSaleResult.
export interface CreateJournalEntryResult {
  view: JournalEntryView;
  created: boolean;
}

type JournalEntryWithLines = Prisma.JournalEntryGetPayload<{ include: { lines: { include: { account: true } } } }>;

// Seul point d'accès Prisma pour JournalEntry/JournalEntryLine (CLAUDE.md
// §5/§8). Module 8 de la Phase 8 : comme StockRepository, pas
// d'update/delete — create() est la seule écriture possible, une correction
// se fait par une nouvelle écriture de contre-passation.
@Injectable()
export class JournalRepository {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async create(
    enterpriseId: string,
    input: CreateJournalEntryInput,
    idempotencyKey?: string,
  ): Promise<CreateJournalEntryResult> {
    // Corrige ACC-01 (docs/audit/ACCOUNTING-AUDIT.md) : la partie double
    // n'était vérifiée que par createJournalEntrySchema (Zod), en périphérie
    // HTTP. CreateJournalEntryInput est une inférence de forme, pas une
    // preuve d'exécution du .refine() — rien n'empêche au niveau du langage
    // d'appeler create() directement (job de reprise, seed, futur module
    // d'auto-comptabilisation) avec des lignes déséquilibrées. Défense en
    // profondeur : revérifié ici, à la source de vérité transactionnelle,
    // indépendamment du contrôleur HTTP. Un CHECK SQL par ligne (migration
    // 20260816150000_add_journal_entry_line_check_constraint) protège aussi
    // un accès direct à la base ; seule la somme débit=crédit par écriture
    // reste hors de portée d'un CHECK simple (non traité ici, voir ACC-01
    // point 3 de la solution).
    const totalDebit = input.lines.reduce((sum, line) => sum + line.debitAmount, 0);
    const totalCredit = input.lines.reduce((sum, line) => sum + line.creditAmount, 0);
    if (totalDebit !== totalCredit || totalDebit <= 0) {
      throw new ConflictException("Écriture déséquilibrée : le total des débits doit être égal au total des crédits");
    }
    for (const line of input.lines) {
      if ((line.debitAmount > 0) === (line.creditAmount > 0)) {
        throw new ConflictException("Une ligne doit porter soit un débit, soit un crédit, jamais les deux ni aucun des deux");
      }
    }

    return this.tenantPrisma.run(async (tx) => {
      // Corrige MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) — même patron
      // que SalesRepository.create. Vérifié avant l'incrément du compteur
      // de numérotation ci-dessous : un rejeu ne doit jamais consommer un
      // nouveau numéro d'écriture.
      if (idempotencyKey) {
        const existing = await tx.journalEntry.findFirst({
          where: { enterpriseId, idempotencyKey },
          include: { lines: { include: { account: true } } },
        });
        if (existing) {
          return { view: this.toEntryView(existing), created: false };
        }
      }

      const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
      const accounts = await tx.account.findMany({ where: { id: { in: accountIds } } });
      const accountsById = new Map(accounts.map((account) => [account.id, account]));

      for (const accountId of accountIds) {
        const account = accountsById.get(accountId);
        if (!account || account.enterpriseId !== enterpriseId) {
          throw new NotFoundException(`Compte introuvable : ${accountId}`);
        }
      }

      // Numérotation séquentielle par tenant, sans trou, résistante à la
      // concurrence — même patron que SalesInvoiceCounter/InvoiceGenerationService.
      const rows = await tx.$queryRaw<{ last_number: number }[]>`
        INSERT INTO journal_entry_counters (enterprise_id, last_number, updated_at)
        VALUES (${enterpriseId}::uuid, 1, now())
        ON CONFLICT (enterprise_id)
        DO UPDATE SET last_number = journal_entry_counters.last_number + 1, updated_at = now()
        RETURNING last_number
      `;
      const sequenceNumber = rows[0]!.last_number;
      const number = `ECR-${enterpriseId.slice(0, 8).toUpperCase()}-${String(sequenceNumber).padStart(6, "0")}`;

      try {
        const entry = await tx.journalEntry.create({
          data: {
            enterpriseId,
            number,
            entryDate: input.entryDate,
            reference: input.reference,
            description: input.description,
            idempotencyKey: idempotencyKey ?? null,
            lines: {
              create: input.lines.map((line) => ({
                enterpriseId,
                accountId: line.accountId,
                label: line.label,
                debitAmount: line.debitAmount,
                creditAmount: line.creditAmount,
              })),
            },
          },
          include: { lines: { include: { account: true } } },
        });

        return { view: this.toEntryView(entry), created: true };
      } catch (error) {
        // Filet de concurrence, même patron que SalesRepository.create.
        if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await tx.journalEntry.findFirst({
            where: { enterpriseId, idempotencyKey },
            include: { lines: { include: { account: true } } },
          });
          if (existing) {
            return { view: this.toEntryView(existing), created: false };
          }
        }
        throw error;
      }
    });
  }

  async findMany(enterpriseId: string, query: ListJournalEntriesQuery): Promise<JournalEntryListResult> {
    const where: Prisma.JournalEntryWhereInput = {
      enterpriseId,
      ...(query.accountId ? { lines: { some: { accountId: query.accountId } } } : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: "insensitive" } },
              { description: { contains: query.search, mode: "insensitive" } },
              { reference: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [entries, total] = await this.tenantPrisma.run((tx) =>
      Promise.all([
        tx.journalEntry.findMany({
          where,
          include: { lines: { include: { account: true } } },
          orderBy: { entryDate: "desc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.journalEntry.count({ where }),
      ]),
    );

    return { items: entries.map((entry) => this.toEntryView(entry)), total, page: query.page, pageSize: query.pageSize };
  }

  async findByIdOrThrow(enterpriseId: string, id: string): Promise<JournalEntryView> {
    return this.tenantPrisma.run(async (tx) => {
      const entry = await tx.journalEntry.findUnique({
        where: { id },
        include: { lines: { include: { account: true } } },
      });

      // 404 pas 403 (même raisonnement que SalesRepository) : pas de fuite
      // d'information sur l'existence d'une écriture d'un autre tenant.
      if (!entry || entry.enterpriseId !== enterpriseId) {
        throw new NotFoundException("Écriture introuvable");
      }

      return this.toEntryView(entry);
    });
  }

  private toEntryView(entry: JournalEntryWithLines): JournalEntryView {
    const lines: JournalEntryLineView[] = entry.lines.map((line) => ({
      id: line.id,
      accountId: line.accountId,
      accountCode: line.account.code,
      accountLabel: line.account.label,
      label: line.label,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
    }));

    const totals = lines.reduce(
      (acc, line) => ({
        totalDebit: acc.totalDebit + line.debitAmount,
        totalCredit: acc.totalCredit + line.creditAmount,
      }),
      { totalDebit: 0, totalCredit: 0 },
    );

    return {
      id: entry.id,
      enterpriseId: entry.enterpriseId,
      number: entry.number,
      entryDate: entry.entryDate,
      reference: entry.reference,
      description: entry.description,
      lines,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...totals,
    };
  }
}
