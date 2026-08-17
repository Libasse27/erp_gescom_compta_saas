import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { createSetupAdmin, createTenantFixtureTracking, cleanupTenantFixtures, TenantFixture } from "../../test/tenant-fixtures";

// Suite test:tenant — adaptation du critère générique "toute liste retournée
// par un endpoint ne contient que des documents de A" aux endpoints
// d'agrégation de Rapports (pas de liste à proprement parler) : les totaux
// d'un tenant ne doivent jamais inclure l'activité d'un autre tenant.
describe("ReportsController — tenant isolation (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let setupAdmin: (label: string) => Promise<TenantFixture>;
  const tracking = createTenantFixtureTracking();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    setupAdmin = createSetupAdmin(app, prisma, app.get(PasswordService), tracking);
  });

  afterAll(async () => {
    await prisma.journalEntryLine.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.journalEntry.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.journalEntryCounter.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.account.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.saleLine.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.sale.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.customer.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await cleanupTenantFixtures(prisma, tracking);
    await app.close();
  });

  async function createConfirmedSale(enterpriseId: string, quantity: number) {
    const customer = await prisma.customer.create({ data: { enterpriseId, type: "COMPANY", name: "Client test" } });
    const product = await prisma.product.create({
      data: { enterpriseId, code: `SKU-${randomUUID()}`, name: "Produit test", sellingPriceExcludingTax: 1_000, vatRateBasisPoints: 1_800, trackStock: false },
    });
    return prisma.sale.create({
      data: {
        enterpriseId,
        customerId: customer.id,
        status: "CONFIRMED",
        confirmedAt: new Date(),
        lines: { create: { enterpriseId, productId: product.id, quantity, unitPriceExcludingTax: 1_000, vatRateBasisPoints: 1_800 } },
      },
    });
  }

  it("never includes another tenant's confirmed sales in the sales report totals", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");

    await createConfirmedSale(tenantA.enterpriseId, 1); // 1180 TTC
    await createConfirmedSale(tenantB.enterpriseId, 1_000); // très large, détecterait une fuite immédiatement

    const res = await request(app.getHttpServer())
      .get("/reports/sales")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    expect(res.body.count).toBe(1);
    expect(res.body.totalExcludingTax).toBe(1_000);
    expect(res.body.totalIncludingTax).toBe(1_180);
  });

  it("never includes another tenant's journal entries in the income statement", async () => {
    const tenantA = await setupAdmin("Tenant A Journal");
    const tenantB = await setupAdmin("Tenant B Journal");

    const salesAccountA = await prisma.account.create({ data: { enterpriseId: tenantA.enterpriseId, code: "701000", label: "Ventes A" } });
    const bankAccountA = await prisma.account.create({ data: { enterpriseId: tenantA.enterpriseId, code: "521000", label: "Banque A" } });
    await prisma.journalEntry.create({
      data: {
        enterpriseId: tenantA.enterpriseId,
        number: `ECR-A-${randomUUID().slice(0, 6)}`,
        description: "Vente A",
        lines: {
          create: [
            { enterpriseId: tenantA.enterpriseId, accountId: bankAccountA.id, debitAmount: 1_000, creditAmount: 0 },
            { enterpriseId: tenantA.enterpriseId, accountId: salesAccountA.id, debitAmount: 0, creditAmount: 1_000 },
          ],
        },
      },
    });

    const salesAccountB = await prisma.account.create({ data: { enterpriseId: tenantB.enterpriseId, code: "701000", label: "Ventes B" } });
    const bankAccountB = await prisma.account.create({ data: { enterpriseId: tenantB.enterpriseId, code: "521000", label: "Banque B" } });
    await prisma.journalEntry.create({
      data: {
        enterpriseId: tenantB.enterpriseId,
        number: `ECR-B-${randomUUID().slice(0, 6)}`,
        description: "Vente B — très large, détecterait une fuite",
        lines: {
          create: [
            { enterpriseId: tenantB.enterpriseId, accountId: bankAccountB.id, debitAmount: 999_999, creditAmount: 0 },
            { enterpriseId: tenantB.enterpriseId, accountId: salesAccountB.id, debitAmount: 0, creditAmount: 999_999 },
          ],
        },
      },
    });

    const res = await request(app.getHttpServer())
      .get("/reports/income-statement")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    expect(res.body.totalRevenue).toBe(1_000);
  });
});
