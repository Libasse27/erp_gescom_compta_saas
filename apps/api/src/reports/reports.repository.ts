import { Injectable } from "@nestjs/common";
import { ReportPeriodQuery } from "@erp/validation";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";

export interface ReportDailyPoint {
  date: string;
  count: number;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
}

export interface SalesReportView {
  dateFrom: Date;
  dateTo: Date;
  count: number;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  byDay: ReportDailyPoint[];
}

export interface PurchasesReportView {
  dateFrom: Date;
  dateTo: Date;
  count: number;
  totalExcludingTax: number;
  totalVat: number;
  totalIncludingTax: number;
  byDay: ReportDailyPoint[];
}

export interface IncomeStatementAccountLine {
  accountId: string;
  accountCode: string;
  accountLabel: string;
  amount: number;
}

export interface IncomeStatementView {
  dateFrom: Date;
  dateTo: Date;
  totalRevenue: number;
  totalExpenses: number;
  netResult: number;
  revenueByAccount: IncomeStatementAccountLine[];
  expensesByAccount: IncomeStatementAccountLine[];
}

function lineTotals(quantity: number, unitAmountExcludingTax: number, vatRateBasisPoints: number) {
  const lineTotalExcludingTax = quantity * unitAmountExcludingTax;
  const lineTotalVat = Math.round((lineTotalExcludingTax * vatRateBasisPoints) / 10_000);
  return { lineTotalExcludingTax, lineTotalVat, lineTotalIncludingTax: lineTotalExcludingTax + lineTotalVat };
}

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function startOfCurrentYear(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Accumulateur partagé par salesReport/purchasesReport : les deux
// construisent la même forme (count + totaux + points par jour), seule la
// façon d'obtenir les totaux d'une ligne diffère (unitPriceExcludingTax vs
// unitCostExcludingTax) — laissée à l'appelant plutôt que devinée ici.
class DailyAccumulator {
  private readonly byDay = new Map<string, ReportDailyPoint>();
  count = 0;
  totalExcludingTax = 0;
  totalVat = 0;
  totalIncludingTax = 0;

  add(date: Date, totals: { totalExcludingTax: number; totalVat: number; totalIncludingTax: number }): void {
    this.count += 1;
    this.totalExcludingTax += totals.totalExcludingTax;
    this.totalVat += totals.totalVat;
    this.totalIncludingTax += totals.totalIncludingTax;

    const key = dayKey(date);
    const point = this.byDay.get(key) ?? { date: key, count: 0, totalExcludingTax: 0, totalVat: 0, totalIncludingTax: 0 };
    point.count += 1;
    point.totalExcludingTax += totals.totalExcludingTax;
    point.totalVat += totals.totalVat;
    point.totalIncludingTax += totals.totalIncludingTax;
    this.byDay.set(key, point);
  }

  build(dateFrom: Date, dateTo: Date) {
    return {
      dateFrom,
      dateTo,
      count: this.count,
      totalExcludingTax: this.totalExcludingTax,
      totalVat: this.totalVat,
      totalIncludingTax: this.totalIncludingTax,
      byDay: [...this.byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}

// Module 9 de la Phase 8 : lecture seule, agrège Sale/Purchase/JournalEntryLine
// (modules 5, 6, 8) — aucun modèle Prisma propre, aucune écriture. Comme les
// autres repositories, seul point d'accès Prisma pour ces requêtes de
// rapport (CLAUDE.md §5/§8), même si les modèles sous-jacents appartiennent
// à d'autres modules.
@Injectable()
export class ReportsRepository {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  // Défaut : mois en cours — activité récente, pas un exercice comptable
  // (contrairement à incomeStatement).
  async salesReport(enterpriseId: string, query: ReportPeriodQuery): Promise<SalesReportView> {
    const dateFrom = query.dateFrom ?? startOfCurrentMonth();
    const dateTo = query.dateTo ?? new Date();

    return this.tenantPrisma.run(async (tx) => {
      const sales = await tx.sale.findMany({
        where: { enterpriseId, status: "CONFIRMED", saleDate: { gte: dateFrom, lte: dateTo } },
        include: { lines: true },
      });

      const acc = new DailyAccumulator();
      for (const sale of sales) {
        const totals = sale.lines.reduce(
          (sum, line) => {
            const t = lineTotals(line.quantity, line.unitPriceExcludingTax, line.vatRateBasisPoints);
            return {
              totalExcludingTax: sum.totalExcludingTax + t.lineTotalExcludingTax,
              totalVat: sum.totalVat + t.lineTotalVat,
              totalIncludingTax: sum.totalIncludingTax + t.lineTotalIncludingTax,
            };
          },
          { totalExcludingTax: 0, totalVat: 0, totalIncludingTax: 0 },
        );
        acc.add(sale.saleDate, totals);
      }

      return acc.build(dateFrom, dateTo);
    });
  }

  async purchasesReport(enterpriseId: string, query: ReportPeriodQuery): Promise<PurchasesReportView> {
    const dateFrom = query.dateFrom ?? startOfCurrentMonth();
    const dateTo = query.dateTo ?? new Date();

    return this.tenantPrisma.run(async (tx) => {
      const purchases = await tx.purchase.findMany({
        where: { enterpriseId, status: "CONFIRMED", purchaseDate: { gte: dateFrom, lte: dateTo } },
        include: { lines: true },
      });

      const acc = new DailyAccumulator();
      for (const purchase of purchases) {
        const totals = purchase.lines.reduce(
          (sum, line) => {
            const t = lineTotals(line.quantity, line.unitCostExcludingTax, line.vatRateBasisPoints);
            return {
              totalExcludingTax: sum.totalExcludingTax + t.lineTotalExcludingTax,
              totalVat: sum.totalVat + t.lineTotalVat,
              totalIncludingTax: sum.totalIncludingTax + t.lineTotalIncludingTax,
            };
          },
          { totalExcludingTax: 0, totalVat: 0, totalIncludingTax: 0 },
        );
        acc.add(purchase.purchaseDate, totals);
      }

      return acc.build(dateFrom, dateTo);
    });
  }

  // Défaut : année civile en cours (1er janvier -> aujourd'hui) — un compte
  // de résultat se lit sur un exercice, pas sur les 30 derniers jours.
  async incomeStatement(enterpriseId: string, query: ReportPeriodQuery): Promise<IncomeStatementView> {
    const dateFrom = query.dateFrom ?? startOfCurrentYear();
    const dateTo = query.dateTo ?? new Date();

    return this.tenantPrisma.run(async (tx) => {
      const lines = await tx.journalEntryLine.findMany({
        where: {
          enterpriseId,
          journalEntry: { entryDate: { gte: dateFrom, lte: dateTo } },
          OR: [{ account: { code: { startsWith: "6" } } }, { account: { code: { startsWith: "7" } } }],
        },
        include: { account: true },
      });

      const byAccount = new Map<string, { accountCode: string; accountLabel: string; debit: number; credit: number }>();
      for (const line of lines) {
        const entry = byAccount.get(line.accountId) ?? {
          accountCode: line.account.code,
          accountLabel: line.account.label,
          debit: 0,
          credit: 0,
        };
        entry.debit += line.debitAmount;
        entry.credit += line.creditAmount;
        byAccount.set(line.accountId, entry);
      }

      const revenueByAccount: IncomeStatementAccountLine[] = [];
      const expensesByAccount: IncomeStatementAccountLine[] = [];
      for (const [accountId, entry] of byAccount) {
        if (entry.accountCode.startsWith("7")) {
          // Classe 7 (produits) : solde normal créditeur.
          revenueByAccount.push({ accountId, accountCode: entry.accountCode, accountLabel: entry.accountLabel, amount: entry.credit - entry.debit });
        } else {
          // Classe 6 (charges) : solde normal débiteur.
          expensesByAccount.push({ accountId, accountCode: entry.accountCode, accountLabel: entry.accountLabel, amount: entry.debit - entry.credit });
        }
      }
      revenueByAccount.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
      expensesByAccount.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

      const totalRevenue = revenueByAccount.reduce((sum, line) => sum + line.amount, 0);
      const totalExpenses = expensesByAccount.reduce((sum, line) => sum + line.amount, 0);

      return { dateFrom, dateTo, totalRevenue, totalExpenses, netResult: totalRevenue - totalExpenses, revenueByAccount, expensesByAccount };
    });
  }
}
