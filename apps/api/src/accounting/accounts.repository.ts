import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Account, Prisma } from "@prisma/client";
import { CreateAccountInput, ListAccountsQuery, UpdateAccountInput } from "@erp/validation";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";

// Vue calculée (compte + solde agrégé de ses lignes d'écriture), pas un
// modèle Prisma direct — même raisonnement que StockLevel dans
// stock.repository.ts : le solde n'est jamais stocké, calculé ici.
export interface AccountView extends Account {
  totalDebit: number;
  totalCredit: number;
  balance: number;
}

export interface AccountListResult {
  items: AccountView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TrialBalanceView {
  accounts: AccountView[];
  totalDebit: number;
  totalCredit: number;
}

// Seul point d'accès Prisma pour Account (CLAUDE.md §5/§8). Module 8 de la
// Phase 8 : contrairement à ProductsRepository, pas de deactivate/delete —
// aucune clé de permission "accounting.delete" n'existe (voir
// packages/permissions), un compte référencé par des écritures append-only
// ne doit jamais disparaître.
@Injectable()
export class AccountsRepository {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async findMany(enterpriseId: string, query: ListAccountsQuery): Promise<AccountListResult> {
    const where: Prisma.AccountWhereInput = {
      enterpriseId,
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: "insensitive" } },
              { label: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const { items, total } = await this.tenantPrisma.run(async (tx) => {
      const [accounts, total] = await Promise.all([
        tx.account.findMany({
          where,
          orderBy: { code: "asc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.account.count({ where }),
      ]);

      const balances = await this.aggregateBalances(
        tx,
        enterpriseId,
        accounts.map((account) => account.id),
      );

      return { items: accounts.map((account) => this.toAccountView(account, balances)), total };
    });

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findByIdOrThrow(enterpriseId: string, id: string): Promise<AccountView> {
    return this.tenantPrisma.run(async (tx) => {
      const account = await this.getAccountOrThrow(tx, enterpriseId, id);
      const balances = await this.aggregateBalances(tx, enterpriseId, [id]);
      return this.toAccountView(account, balances);
    });
  }

  async create(enterpriseId: string, input: CreateAccountInput): Promise<AccountView> {
    const account = await this.withUniqueCodeConflictMapped(() =>
      this.tenantPrisma.run((tx) => tx.account.create({ data: { ...input, enterpriseId } })),
    );
    return this.toAccountView(account, new Map());
  }

  async update(enterpriseId: string, id: string, input: UpdateAccountInput): Promise<AccountView> {
    // Vérifie l'appartenance au tenant avant d'écrire (même raisonnement que
    // ProductsRepository.update) : un update "aveugle" par id seul
    // s'appuierait uniquement sur la RLS, qui affecterait alors 0 ligne sans
    // lever d'erreur explicite — on préfère un 404 clair.
    await this.tenantPrisma.run((tx) => this.getAccountOrThrow(tx, enterpriseId, id));

    const account = await this.tenantPrisma.run((tx) => tx.account.update({ where: { id }, data: input }));
    const balances = await this.tenantPrisma.run((tx) => this.aggregateBalances(tx, enterpriseId, [id]));
    return this.toAccountView(account, balances);
  }

  // Balance des comptes : tous les comptes du tenant avec leur solde, triés
  // par code — pas de pagination (un comptable doit voir l'ensemble pour
  // vérifier que le total débit = total crédit global).
  async trialBalance(enterpriseId: string): Promise<TrialBalanceView> {
    return this.tenantPrisma.run(async (tx) => {
      const accounts = await tx.account.findMany({ where: { enterpriseId }, orderBy: { code: "asc" } });
      const balances = await this.aggregateBalances(
        tx,
        enterpriseId,
        accounts.map((account) => account.id),
      );

      const views = accounts.map((account) => this.toAccountView(account, balances));
      const totals = views.reduce(
        (acc, view) => ({
          totalDebit: acc.totalDebit + view.totalDebit,
          totalCredit: acc.totalCredit + view.totalCredit,
        }),
        { totalDebit: 0, totalCredit: 0 },
      );

      return { accounts: views, ...totals };
    });
  }

  private async getAccountOrThrow(tx: Prisma.TransactionClient, enterpriseId: string, id: string): Promise<Account> {
    const account = await tx.account.findUnique({ where: { id } });

    // 404 pas 403 (même raisonnement que ProductsRepository) : pas de fuite
    // d'information sur l'existence d'un compte d'un autre tenant.
    if (!account || account.enterpriseId !== enterpriseId) {
      throw new NotFoundException("Compte introuvable");
    }

    return account;
  }

  private async aggregateBalances(
    tx: Prisma.TransactionClient,
    enterpriseId: string,
    accountIds: string[],
  ): Promise<Map<string, { totalDebit: number; totalCredit: number }>> {
    if (accountIds.length === 0) return new Map();

    // Une seule requête groupée pour tous les comptes de la page — évite le
    // N+1, même patron que StockRepository.aggregateQuantities.
    const groups = await tx.journalEntryLine.groupBy({
      by: ["accountId"],
      where: { enterpriseId, accountId: { in: accountIds } },
      _sum: { debitAmount: true, creditAmount: true },
    });

    const balances = new Map<string, { totalDebit: number; totalCredit: number }>();
    for (const group of groups) {
      balances.set(group.accountId, {
        totalDebit: group._sum.debitAmount ?? 0,
        totalCredit: group._sum.creditAmount ?? 0,
      });
    }
    return balances;
  }

  private toAccountView(
    account: Account,
    balances: Map<string, { totalDebit: number; totalCredit: number }>,
  ): AccountView {
    const { totalDebit, totalCredit } = balances.get(account.id) ?? { totalDebit: 0, totalCredit: 0 };
    return { ...account, totalDebit, totalCredit, balance: totalDebit - totalCredit };
  }

  // @@unique([enterpriseId, code]) : même patron que
  // ProductsRepository.withUniqueCodeConflictMapped.
  private async withUniqueCodeConflictMapped<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Ce code de compte est déjà utilisé");
      }
      throw error;
    }
  }
}
