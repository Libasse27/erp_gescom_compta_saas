import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PermissionKey } from "@erp/permissions";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Module 7 de la Phase 8, miroir de sales.integration.spec.ts/
// purchases.integration.spec.ts. Client, produit, vente et ses lignes sont
// insérés directement via `prisma` avec la vente déjà CONFIRMED (contourne
// la RLS, comme les autres modules) : seule la feature "invoicing" est le
// sujet de ce module.
describe("InvoicingController (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let invoicingFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
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

  async function setupTenant(permissions: PermissionKey[], invoicingFeatureEnabled = true) {
    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        planFeatures: { create: { featureId: invoicingFeatureId, enabled: invoicingFeatureEnabled } },
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({
      data: { name: `Invoicing Test ${randomUUID()}`, legalName: "Entreprise Test SARL", ninea: randomUUID().slice(0, 8) },
    });
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
        lines: { create: { enterpriseId, productId: product.id, quantity: 2, unitPriceExcludingTax: 1_000, vatRateBasisPoints: 1_800 } },
      },
    });
  }

  async function createDraftSale(enterpriseId: string) {
    const customer = await prisma.customer.create({ data: { enterpriseId, type: "COMPANY", name: "Client test" } });
    const product = await prisma.product.create({
      data: { enterpriseId, code: `SKU-${randomUUID()}`, name: "Produit test", sellingPriceExcludingTax: 1_000, trackStock: false },
    });
    return prisma.sale.create({
      data: {
        enterpriseId,
        customerId: customer.id,
        lines: { create: { enterpriseId, productId: product.id, quantity: 1, unitPriceExcludingTax: 1_000, vatRateBasisPoints: 1_800 } },
      },
    });
  }

  it("supports the full lifecycle: issue an invoice for a confirmed sale, then mark it paid", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["invoicing.read", "invoicing.create", "invoicing.update"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const sale = await createConfirmedSale(enterpriseId);

    const createRes = await request(app.getHttpServer())
      .post("/invoices")
      .set(auth)
      .send({ saleId: sale.id })
      .expect(201);
    expect(createRes.body.status).toBe("ISSUED");
    expect(createRes.body.totalExcludingTax).toBe(2_000);
    expect(createRes.body.totalIncludingTax).toBe(2_360);
    const invoiceId = createRes.body.id as string;

    const getRes = await request(app.getHttpServer()).get(`/invoices/${invoiceId}`).set(auth).expect(200);
    expect(getRes.body.lines).toHaveLength(1);

    const listRes = await request(app.getHttpServer()).get("/invoices").set(auth).expect(200);
    expect(listRes.body.items.map((i: { id: string }) => i.id)).toContain(invoiceId);

    const paidRes = await request(app.getHttpServer()).post(`/invoices/${invoiceId}/mark-paid`).set(auth).expect(201);
    expect(paidRes.body.status).toBe("PAID");
  });

  // Régression MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) — même patron
  // que sales.integration.spec.ts.
  it("returns the same invoice on a replayed POST /invoices carrying the same Idempotency-Key header", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["invoicing.create"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const sale = await createConfirmedSale(enterpriseId);
    const idempotencyKey = randomUUID();

    const firstRes = await request(app.getHttpServer())
      .post("/invoices")
      .set(auth)
      .set("Idempotency-Key", idempotencyKey)
      .send({ saleId: sale.id })
      .expect(201);

    const secondRes = await request(app.getHttpServer())
      .post("/invoices")
      .set(auth)
      .set("Idempotency-Key", idempotencyKey)
      .send({ saleId: sale.id })
      .expect(201);

    expect(secondRes.body.id).toBe(firstRes.body.id);

    const invoices = await prisma.salesInvoice.findMany({ where: { enterpriseId, saleId: sale.id } });
    expect(invoices).toHaveLength(1);
  });

  it("rejects invoicing a sale that is not confirmed (400)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["invoicing.create"]);
    const draft = await createDraftSale(enterpriseId);

    await request(app.getHttpServer())
      .post("/invoices")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ saleId: draft.id })
      .expect(400);
  });

  it("rejects invoicing the same sale twice (409)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["invoicing.create"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const sale = await createConfirmedSale(enterpriseId);

    await request(app.getHttpServer()).post("/invoices").set(auth).send({ saleId: sale.id }).expect(201);
    await request(app.getHttpServer()).post("/invoices").set(auth).send({ saleId: sale.id }).expect(409);
  });

  it("voids an ISSUED invoice but rejects voiding an already-paid one (400)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["invoicing.create", "invoicing.update", "invoicing.delete"]);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const saleForVoid = await createConfirmedSale(enterpriseId);
    const voidRes = await request(app.getHttpServer()).post("/invoices").set(auth).send({ saleId: saleForVoid.id }).expect(201);
    const voidedRes = await request(app.getHttpServer()).post(`/invoices/${voidRes.body.id}/void`).set(auth).expect(201);
    expect(voidedRes.body.status).toBe("VOID");

    const salePaid = await createConfirmedSale(enterpriseId);
    const paidInvoiceRes = await request(app.getHttpServer()).post("/invoices").set(auth).send({ saleId: salePaid.id }).expect(201);
    await request(app.getHttpServer()).post(`/invoices/${paidInvoiceRes.body.id}/mark-paid`).set(auth).expect(201);

    await request(app.getHttpServer()).post(`/invoices/${paidInvoiceRes.body.id}/void`).set(auth).expect(400);
  });

  it("rejects without the matching invoicing.* permission (403)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["invoicing.read"]); // pas invoicing.create
    const sale = await createConfirmedSale(enterpriseId);

    await request(app.getHttpServer())
      .post("/invoices")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ saleId: sale.id })
      .expect(403);
  });

  it("rejects every route when the plan does not have the invoicing feature enabled (403)", async () => {
    const { accessToken } = await setupTenant(["invoicing.read", "invoicing.create"], false);

    await request(app.getHttpServer()).get("/invoices").set("Authorization", `Bearer ${accessToken}`).expect(403);
  });
});
