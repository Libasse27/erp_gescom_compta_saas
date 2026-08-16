import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Suite test:tenant — adaptation du critère générique "toute liste retournée
// par un endpoint ne contient que des documents de A" aux endpoints
// d'agrégation de Rapports (pas de liste à proprement parler) : les totaux
// d'un tenant ne doivent jamais inclure l'activité d'un autre tenant.
describe("ReportsController — tenant isolation (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let reportsFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);

    const feature = await prisma.feature.upsert({
      where: { key: "reports" },
      create: { key: "reports", label: "Rapports" },
      update: {},
    });
    reportsFeatureId = feature.id;
  });

  afterAll(async () => {
    await prisma.journalEntryLine.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.journalEntry.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.journalEntryCounter.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.account.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.saleLine.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.sale.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.customer.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.userRole.deleteMany({ where: { user: { enterpriseId: { in: createdEnterpriseIds } } } });
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.rolePermission.deleteMany({ where: { role: { enterpriseId: { in: createdEnterpriseIds } } } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  async function setupAdmin(label: string) {
    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        planFeatures: { create: { featureId: reportsFeatureId, enabled: true } },
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `${label} ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: "ACTIVE", startDate: new Date() },
    });
    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { currentSubscriptionId: subscription.id } });

    const role = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "ADMIN" } });
    const permission = await prisma.permission.upsert({ where: { key: "reports.read" }, create: { key: "reports.read" }, update: {} });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });

    const password = "TestPassword9!";
    const user = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Admin",
        lastName: label,
        enterpriseId: enterprise.id,
        status: "ACTIVE",
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password })
      .expect(200);

    return { enterpriseId: enterprise.id, accessToken: loginRes.body.accessToken as string };
  }

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
