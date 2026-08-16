import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PermissionKey } from "@erp/permissions";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Module 4 de la Phase 8 : contrairement à Clients/Fournisseurs/Produits
// (CRUD nominal), Stock est un grand livre append-only — les mouvements
// sont créés (POST /stock/movements), jamais modifiés/supprimés. Les
// produits nécessaires aux tests sont insérés directement via `prisma`
// (rôle identité, contourne la RLS comme tenant-isolation.tenant.spec.ts) :
// pas besoin d'activer la feature "products" sur le plan de test, seule
// "stock" est le sujet de ce module.
describe("StockController (integration)", () => {
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

  async function setupTenant(permissions: PermissionKey[], stockFeatureEnabled = true) {
    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        planFeatures: { create: { featureId: stockFeatureId, enabled: stockFeatureEnabled } },
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `Stock Test ${randomUUID()}` } });
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

  function createProduct(enterpriseId: string, trackStock = true) {
    return prisma.product.create({
      data: {
        enterpriseId,
        code: `SKU-${randomUUID()}`,
        name: "Produit test",
        sellingPriceExcludingTax: 1_000,
        trackStock,
      },
    });
  }

  it("supports creating movements and reading the resulting stock level and history", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["stock.read", "stock.create"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const product = await createProduct(enterpriseId);

    const inRes = await request(app.getHttpServer())
      .post("/stock/movements")
      .set(auth)
      .send({ productId: product.id, type: "IN", quantity: 50, note: "Réception fournisseur" })
      .expect(201);
    expect(inRes.body.quantityOnHand).toBe(50);
    expect(inRes.body.movement.type).toBe("IN");

    const outRes = await request(app.getHttpServer())
      .post("/stock/movements")
      .set(auth)
      .send({ productId: product.id, type: "OUT", quantity: 20 })
      .expect(201);
    expect(outRes.body.quantityOnHand).toBe(30);

    const levelRes = await request(app.getHttpServer()).get(`/stock/${product.id}`).set(auth).expect(200);
    expect(levelRes.body.quantityOnHand).toBe(30);
    expect(levelRes.body.code).toBe(product.code);

    const listRes = await request(app.getHttpServer()).get("/stock").set(auth).expect(200);
    const entry = listRes.body.items.find((item: { productId: string }) => item.productId === product.id);
    expect(entry.quantityOnHand).toBe(30);

    const movementsRes = await request(app.getHttpServer())
      .get(`/stock/${product.id}/movements`)
      .set(auth)
      .expect(200);
    expect(movementsRes.body.total).toBe(2);
  });

  it("rejects invalid input (400): non-positive quantity for IN, zero for ADJUSTMENT", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["stock.create"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const product = await createProduct(enterpriseId);

    await request(app.getHttpServer())
      .post("/stock/movements")
      .set(auth)
      .send({ productId: product.id, type: "IN", quantity: 0 })
      .expect(400);

    await request(app.getHttpServer())
      .post("/stock/movements")
      .set(auth)
      .send({ productId: product.id, type: "ADJUSTMENT", quantity: 0 })
      .expect(400);
  });

  it("rejects a movement that would bring the stock below zero (409)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["stock.create"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const product = await createProduct(enterpriseId);

    await request(app.getHttpServer())
      .post("/stock/movements")
      .set(auth)
      .send({ productId: product.id, type: "IN", quantity: 5 })
      .expect(201);

    await request(app.getHttpServer())
      .post("/stock/movements")
      .set(auth)
      .send({ productId: product.id, type: "OUT", quantity: 10 })
      .expect(409);
  });

  it("rejects a movement on a product that does not track stock (400)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["stock.create"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const product = await createProduct(enterpriseId, false);

    await request(app.getHttpServer())
      .post("/stock/movements")
      .set(auth)
      .send({ productId: product.id, type: "IN", quantity: 10 })
      .expect(400);
  });

  it("returns 404 when reading the level of a product that does not track stock", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["stock.read"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const product = await createProduct(enterpriseId, false);

    await request(app.getHttpServer()).get(`/stock/${product.id}`).set(auth).expect(404);
  });

  it("rejects without the matching stock.* permission (403)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["stock.read"]); // pas stock.create
    const product = await createProduct(enterpriseId);

    await request(app.getHttpServer())
      .post("/stock/movements")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ productId: product.id, type: "IN", quantity: 10 })
      .expect(403);
  });

  it("rejects every route when the plan does not have the stock feature enabled (403)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["stock.read", "stock.create"], false);
    const product = await createProduct(enterpriseId);

    await request(app.getHttpServer()).get("/stock").set("Authorization", `Bearer ${accessToken}`).expect(403);

    await request(app.getHttpServer())
      .post("/stock/movements")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ productId: product.id, type: "IN", quantity: 10 })
      .expect(403);
  });
});
