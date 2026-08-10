import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "../auth/password.service";

// Suite test:tenant — copie conforme de sales.tenant.spec.ts/
// purchases.tenant.spec.ts (modules 5 et 6) : GET /invoices/:id d'un autre
// tenant => 404 (pas 403), GET /invoices ne fuit jamais vers un autre
// tenant, et un saleId d'un autre tenant dans le body de création est
// rejeté (404), jamais scopé silencieusement.
describe("InvoicingController — tenant isolation (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let invoicingFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);

    const feature = await prisma.feature.upsert({
      where: { key: "invoicing" },
      create: { key: "invoicing", label: "Facturation" },
      update: {},
    });
    invoicingFeatureId = feature.id;
  });

  afterAll(async () => {
    await prisma.salesInvoice.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.salesInvoiceCounter.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
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
        planFeatures: { create: { featureId: invoicingFeatureId, enabled: true } },
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
    for (const key of ["invoicing.read", "invoicing.create"] as const) {
      const permission = await prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }

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

  async function createConfirmedSale(enterpriseId: string) {
    const customer = await prisma.customer.create({ data: { enterpriseId, type: "COMPANY", name: "Client test" } });
    const product = await prisma.product.create({
      data: { enterpriseId, code: `SKU-${randomUUID()}`, name: "Produit test", sellingPriceExcludingTax: 1_000, trackStock: false },
    });
    return prisma.sale.create({
      data: {
        enterpriseId,
        customerId: customer.id,
        status: "CONFIRMED",
        confirmedAt: new Date(),
        lines: { create: { enterpriseId, productId: product.id, quantity: 1, unitPriceExcludingTax: 1_000, vatRateBasisPoints: 1_800 } },
      },
    });
  }

  it("returns 404 (not 403) when reading another tenant's invoice by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");
    const saleB = await createConfirmedSale(tenantB.enterpriseId);

    const created = await request(app.getHttpServer())
      .post("/invoices")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ saleId: saleB.id })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/invoices/${created.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's invoices from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");
    const saleA = await createConfirmedSale(tenantA.enterpriseId);
    const saleB = await createConfirmedSale(tenantB.enterpriseId);

    const invoiceA = await request(app.getHttpServer())
      .post("/invoices")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ saleId: saleA.id })
      .expect(201);
    await request(app.getHttpServer())
      .post("/invoices")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ saleId: saleB.id })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get("/invoices")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    const ids = listA.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(invoiceA.body.id);
    expect(ids).toHaveLength(1);
  });

  it("rejects an invoice referencing another tenant's saleId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Sale");
    const tenantB = await setupAdmin("Tenant B Forge Sale");
    const saleB = await createConfirmedSale(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .post("/invoices")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ saleId: saleB.id })
      .expect(404);

    const invoices = await prisma.salesInvoice.findMany({ where: { saleId: saleB.id } });
    expect(invoices).toHaveLength(0);
  });
});
