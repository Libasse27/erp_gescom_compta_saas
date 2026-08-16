import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Suite test:tenant — copie conforme de stock.tenant.spec.ts (module 5 de la
// Phase 8) : GET /sales/:id d'un autre tenant => 404 (pas 403), GET /sales
// ne fuit jamais vers un autre tenant, et un customerId/productId d'un autre
// tenant dans le body de création est rejeté (404), jamais scopé
// silencieusement — équivalent naturel de "enterpriseId forgé" pour un
// module qui n'a pas de champ enterpriseId direct dans son body.
describe("SalesController — tenant isolation (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let salesFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);

    const feature = await prisma.feature.upsert({
      where: { key: "sales" },
      create: { key: "sales", label: "Ventes" },
      update: {},
    });
    salesFeatureId = feature.id;
  });

  afterAll(async () => {
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
        planFeatures: { create: { featureId: salesFeatureId, enabled: true } },
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
    for (const key of ["sales.read", "sales.create"] as const) {
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

  function createCustomer(enterpriseId: string) {
    return prisma.customer.create({ data: { enterpriseId, type: "COMPANY", name: "Client test" } });
  }

  function createProduct(enterpriseId: string) {
    return prisma.product.create({
      data: { enterpriseId, code: `SKU-${randomUUID()}`, name: "Produit test", sellingPriceExcludingTax: 1_000, trackStock: false },
    });
  }

  it("returns 404 (not 403) when reading another tenant's sale by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");
    const customerB = await createCustomer(tenantB.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    const created = await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ customerId: customerB.id, lines: [{ productId: productB.id, quantity: 1 }] })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/sales/${created.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's sales from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");
    const customerA = await createCustomer(tenantA.enterpriseId);
    const productA = await createProduct(tenantA.enterpriseId);
    const customerB = await createCustomer(tenantB.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    const saleA = await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ customerId: customerA.id, lines: [{ productId: productA.id, quantity: 1 }] })
      .expect(201);
    await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ customerId: customerB.id, lines: [{ productId: productB.id, quantity: 1 }] })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get("/sales")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    const ids = listA.body.items.map((s: { id: string }) => s.id);
    expect(ids).toContain(saleA.body.id);
    expect(ids).toHaveLength(1);
  });

  it("rejects a sale referencing another tenant's customerId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Customer");
    const tenantB = await setupAdmin("Tenant B Forge Customer");
    const customerB = await createCustomer(tenantB.enterpriseId);
    const productA = await createProduct(tenantA.enterpriseId);

    await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ customerId: customerB.id, lines: [{ productId: productA.id, quantity: 1 }] })
      .expect(404);
  });

  it("rejects a sale referencing another tenant's productId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Product");
    const tenantB = await setupAdmin("Tenant B Forge Product");
    const customerA = await createCustomer(tenantA.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ customerId: customerA.id, lines: [{ productId: productB.id, quantity: 1 }] })
      .expect(404);

    const sales = await prisma.sale.findMany({ where: { customerId: customerA.id } });
    expect(sales).toHaveLength(0);
  });
});
