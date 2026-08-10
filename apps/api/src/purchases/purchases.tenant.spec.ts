import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "../auth/password.service";

// Suite test:tenant — copie conforme de sales.tenant.spec.ts (module 5) :
// GET /purchases/:id d'un autre tenant => 404 (pas 403), GET /purchases ne
// fuit jamais vers un autre tenant, et un supplierId/productId d'un autre
// tenant dans le body de création est rejeté (404), jamais scopé
// silencieusement.
describe("PurchasesController — tenant isolation (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let purchasesFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);

    const feature = await prisma.feature.upsert({
      where: { key: "purchases" },
      create: { key: "purchases", label: "Achats" },
      update: {},
    });
    purchasesFeatureId = feature.id;
  });

  afterAll(async () => {
    await prisma.purchaseLine.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.purchase.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.supplier.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
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
        planFeatures: { create: { featureId: purchasesFeatureId, enabled: true } },
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
    for (const key of ["purchases.read", "purchases.create"] as const) {
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

  function createSupplier(enterpriseId: string) {
    return prisma.supplier.create({ data: { enterpriseId, type: "COMPANY", name: "Fournisseur test" } });
  }

  function createProduct(enterpriseId: string) {
    return prisma.product.create({
      data: { enterpriseId, code: `SKU-${randomUUID()}`, name: "Produit test", sellingPriceExcludingTax: 1_000, trackStock: false },
    });
  }

  it("returns 404 (not 403) when reading another tenant's purchase by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");
    const supplierB = await createSupplier(tenantB.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    const created = await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ supplierId: supplierB.id, lines: [{ productId: productB.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/purchases/${created.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's purchases from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");
    const supplierA = await createSupplier(tenantA.enterpriseId);
    const productA = await createProduct(tenantA.enterpriseId);
    const supplierB = await createSupplier(tenantB.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    const purchaseA = await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ supplierId: supplierA.id, lines: [{ productId: productA.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(201);
    await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ supplierId: supplierB.id, lines: [{ productId: productB.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get("/purchases")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    const ids = listA.body.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(purchaseA.body.id);
    expect(ids).toHaveLength(1);
  });

  it("rejects a purchase referencing another tenant's supplierId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Supplier");
    const tenantB = await setupAdmin("Tenant B Forge Supplier");
    const supplierB = await createSupplier(tenantB.enterpriseId);
    const productA = await createProduct(tenantA.enterpriseId);

    await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ supplierId: supplierB.id, lines: [{ productId: productA.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(404);
  });

  it("rejects a purchase referencing another tenant's productId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Product");
    const tenantB = await setupAdmin("Tenant B Forge Product");
    const supplierA = await createSupplier(tenantA.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ supplierId: supplierA.id, lines: [{ productId: productB.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(404);

    const purchases = await prisma.purchase.findMany({ where: { supplierId: supplierA.id } });
    expect(purchases).toHaveLength(0);
  });
});
