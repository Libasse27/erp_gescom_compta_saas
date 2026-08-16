import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Suite test:tenant — copie conforme de products.tenant.spec.ts (module 4
// de la Phase 8), adaptée : pas d'"enterpriseId forgé dans le body" ici
// (Stock n'a pas de route de création de fiche), remplacé par l'équivalent
// naturel du module — un productId d'un autre tenant referencé dans
// POST /stock/movements doit être rejeté (404), jamais scopé silencieusement.
describe("StockController — tenant isolation (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let stockFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);

    const feature = await prisma.feature.upsert({
      where: { key: "stock" },
      create: { key: "stock", label: "Stocks" },
      update: {},
    });
    stockFeatureId = feature.id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
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
        planFeatures: { create: { featureId: stockFeatureId, enabled: true } },
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
    for (const key of ["stock.read", "stock.create"] as const) {
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

  function createProduct(enterpriseId: string) {
    return prisma.product.create({
      data: { enterpriseId, code: `SKU-${randomUUID()}`, name: "Produit test", sellingPriceExcludingTax: 1_000 },
    });
  }

  it("returns 404 (not 403) when reading another tenant's stock level by a guessed productId", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");
    const productB = await createProduct(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .get(`/stock/${productB.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's stock levels from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");
    const productA = await createProduct(tenantA.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .post("/stock/movements")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ productId: productA.id, type: "IN", quantity: 10 })
      .expect(201);
    await request(app.getHttpServer())
      .post("/stock/movements")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ productId: productB.id, type: "IN", quantity: 10 })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get("/stock")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    const ids = listA.body.items.map((item: { productId: string }) => item.productId);
    expect(ids).toContain(productA.id);
    expect(ids).not.toContain(productB.id);
  });

  it("rejects a movement referencing another tenant's productId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge");
    const tenantB = await setupAdmin("Tenant B Forge");
    const productB = await createProduct(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .post("/stock/movements")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ productId: productB.id, type: "IN", quantity: 10 })
      .expect(404);

    const movements = await prisma.stockMovement.findMany({ where: { productId: productB.id } });
    expect(movements).toHaveLength(0);
  });
});
