import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PermissionKey } from "@erp/permissions";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "../auth/password.service";

// Module 9 (dernier) de la Phase 8, miroir des autres integration.spec.ts.
// Fixtures (client/produit/vente confirmée) insérées directement via
// `prisma` (contourne la RLS) : seule la feature "reports" est le sujet de
// ce module.
describe("ReportsController (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let reportsFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
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

  async function setupTenant(permissions: PermissionKey[], reportsFeatureEnabled = true) {
    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        planFeatures: { create: { featureId: reportsFeatureId, enabled: reportsFeatureEnabled } },
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `Reports Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: "ACTIVE", startDate: new Date() },
    });
    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { currentSubscriptionId: subscription.id } });

    const role = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "ROLE_TEST" } });
    for (const key of permissions) {
      const permission = await prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }

    const password = "TestPassword9!";
    const user = await prisma.user.create({
      data: {
        email: `user-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Test",
        lastName: "User",
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

  async function createConfirmedSale(enterpriseId: string) {
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
        lines: { create: { enterpriseId, productId: product.id, quantity: 5, unitPriceExcludingTax: 1_000, vatRateBasisPoints: 1_800 } },
      },
    });
  }

  it("returns a sales report with totals matching a confirmed sale", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["reports.read"]);
    await createConfirmedSale(enterpriseId);

    const res = await request(app.getHttpServer())
      .get("/reports/sales")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.count).toBe(1);
    expect(res.body.totalExcludingTax).toBe(5_000);
    expect(res.body.totalIncludingTax).toBe(5_900);
  });

  it("returns an empty purchases report when there are no confirmed purchases", async () => {
    const { accessToken } = await setupTenant(["reports.read"]);

    const res = await request(app.getHttpServer())
      .get("/reports/purchases")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.count).toBe(0);
    expect(res.body.totalIncludingTax).toBe(0);
  });

  it("returns a zeroed income statement when no journal entries exist", async () => {
    const { accessToken } = await setupTenant(["reports.read"]);

    const res = await request(app.getHttpServer())
      .get("/reports/income-statement")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.totalRevenue).toBe(0);
    expect(res.body.totalExpenses).toBe(0);
    expect(res.body.netResult).toBe(0);
  });

  it("accepts an explicit dateFrom/dateTo period", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["reports.read"]);
    await createConfirmedSale(enterpriseId);

    const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const res = await request(app.getHttpServer())
      .get(`/reports/sales?dateFrom=${farFuture}&dateTo=${farFuture}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.count).toBe(0);
  });

  it("rejects without the reports.read permission (403)", async () => {
    const { accessToken } = await setupTenant([]);

    await request(app.getHttpServer()).get("/reports/sales").set("Authorization", `Bearer ${accessToken}`).expect(403);
  });

  it("rejects every route when the plan does not have the reports feature enabled (403)", async () => {
    const { accessToken } = await setupTenant(["reports.read"], false);

    await request(app.getHttpServer()).get("/reports/sales").set("Authorization", `Bearer ${accessToken}`).expect(403);
  });
});
