import { Injectable } from "@nestjs/common";
import { ReportPeriodQuery } from "@erp/validation";
import { IncomeStatementView, PurchasesReportView, ReportsRepository, SalesReportView } from "./reports.repository";

// Pas d'audit log ici, contrairement aux autres services : lecture pure,
// aucune écriture/action métier à tracer (même raisonnement que
// StockRepository.findLevels, jamais audité).
@Injectable()
export class ReportsService {
  constructor(private readonly reportsRepository: ReportsRepository) {}

  salesReport(enterpriseId: string, query: ReportPeriodQuery): Promise<SalesReportView> {
    return this.reportsRepository.salesReport(enterpriseId, query);
  }

  purchasesReport(enterpriseId: string, query: ReportPeriodQuery): Promise<PurchasesReportView> {
    return this.reportsRepository.purchasesReport(enterpriseId, query);
  }

  incomeStatement(enterpriseId: string, query: ReportPeriodQuery): Promise<IncomeStatementView> {
    return this.reportsRepository.incomeStatement(enterpriseId, query);
  }
}
