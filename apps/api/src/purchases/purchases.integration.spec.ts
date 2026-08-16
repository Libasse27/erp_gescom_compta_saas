import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PermissionKey } from "@erp/permissions";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Module 6 de la Phase 8, miroir de sales.integration.spec.ts. Fournisseurs
// et produits sont insérés directement via `prisma` (contourne la RLS,
// comme Sales) : seule la feature "purchases" est le sujet de ce module.
describe("PurchasesController (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let purchasesFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
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
    await prisma.stockMovement.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
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

  async function setupTenant(permissions: PermissionKey[], purchasesFeatureEnabled = true) {
    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        planFeatures: { create: { featureId: purchasesFeatureId, enabled: purchasesFeatureEnabled } },
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `Purchases Test ${randomUUID()}` } });
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

  function createSupplier(enterpriseId: string) {
    return prisma.supplier.create({ data: { enterpriseId, type: "COMPANY", name: "Fournisseur test" } });
  }

  function createProduct(enterpriseId: string, trackStock = true) {
    return prisma.product.create({
      data: {
        enterpriseId,
        code: `SKU-${randomUUID()}`,
        name: "Produit test",
        sellingPriceExcludingTax: 1_000,
        vatRateBasisPoints: 1_800,
        trackStock,
      },
    });
  }

  it("supports the full lifecycle: create a DRAFT purchase, then confirm it (stock incremented)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["purchases.read", "purchases.create", "purchases.update"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const supplier = await createSupplier(enterpriseId);
    const product = await createProduct(enterpriseId);

    const createRes = await request(app.getHttpServer())
      .post("/purchases")
      .set(auth)
      .send({ supplierId: supplier.id, lines: [{ productId: product.id, quantity: 4, unitCostExcludingTax: 600 }] })
      .expect(201);
    expect(createRes.body.status).toBe("DRAFT");
    expect(createRes.body.totalExcludingTax).toBe(2_400);
    expect(createRes.body.totalIncludingTax).toBe(2_832);
    const purchaseId = createRes.body.id as string;

    const getRes = await request(app.getHttpServer()).get(`/purchases/${purchaseId}`).set(auth).expect(200);
    expect(getRes.body.lines).toHaveLength(1);

    const listRes = await request(app.getHttpServer()).get("/purchases").set(auth).expect(200);
    expect(listRes.body.items.map((p: { id: string }) => p.id)).toContain(purchaseId);

    const confirmRes = await request(app.getHttpServer()).post(`/purchases/${purchaseId}/confirm`).set(auth).expect(201);
    expect(confirmRes.body.status).toBe("CONFIRMED");

    // Vérifié directement via prisma (pas via GET /stock/:id) : ce tenant n'a
    // que la feature "purchases" activée, pas "stock" — même raisonnement
    // que sales.integration.spec.ts.
    const movements = await prisma.stockMovement.findMany({ where: { enterpriseId, productId: product.id } });
    const quantityOnHand = movements.reduce(
      (total, m) => total + (m.type === "OUT" ? -m.quantity : m.quantity),
      0,
    );
    expect(quantityOnHand).toBe(4);
  });

  // Régression MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) — même patron
  // que sales.integration.spec.ts.
  it("returns the same purchase on a replayed POST /purchases carrying the same Idempotency-Key header", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["purchases.read", "purchases.create"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const supplier = await createSupplier(enterpriseId);
    const product = await createProduct(enterpriseId);
    const idempotencyKey = randomUUID();

    const body = { supplierId: supplier.id, lines: [{ productId: product.id, quantity: 2, unitCostExcludingTax: 500 }] };

    const firstRes = await request(app.getHttpServer())
      .post("/purchases")
      .set(auth)
      .set("Idempotency-Key", idempotencyKey)
      .send(body)
      .expect(201);

    const secondRes = await request(app.getHttpServer())
      .post("/purchases")
      .set(auth)
      .set("Idempotency-Key", idempotencyKey)
      .send(body)
      .expect(201);

    expect(secondRes.body.id).toBe(firstRes.body.id);

    const purchases = await prisma.purchase.findMany({ where: { enterpriseId, supplierId: supplier.id } });
    expect(purchases).toHaveLength(1);
  });

  it("rejects invalid input (400): empty lines array", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["purchases.create"]);
    const supplier = await createSupplier(enterpriseId);

    await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ supplierId: supplier.id, lines: [] })
      .expect(400);
  });

  it("cancels a DRAFT purchase but rejects cancelling an already-confirmed one (400)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["purchases.create", "purchases.update", "purchases.delete"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const supplier = await createSupplier(enterpriseId);
    const product = await createProduct(enterpriseId, false);

    const draftRes = await request(app.getHttpServer())
      .post("/purchases")
      .set(auth)
      .send({ supplierId: supplier.id, lines: [{ productId: product.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(201);
    const cancelRes = await request(app.getHttpServer()).post(`/purchases/${draftRes.body.id}/cancel`).set(auth).expect(201);
    expect(cancelRes.body.status).toBe("CANCELLED");

    const confirmedRes = await request(app.getHttpServer())
      .post("/purchases")
      .set(auth)
      .send({ supplierId: supplier.id, lines: [{ productId: product.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(201);
    await request(app.getHttpServer()).post(`/purchases/${confirmedRes.body.id}/confirm`).set(auth).expect(201);

    await request(app.getHttpServer()).post(`/purchases/${confirmedRes.body.id}/cancel`).set(auth).expect(400);
  });

  it("rejects without the matching purchases.* permission (403)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["purchases.read"]); // pas purchases.create
    const supplier = await createSupplier(enterpriseId);

    await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ supplierId: supplier.id, lines: [{ productId: randomUUID(), quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(403);
  });

  it("rejects every route when the plan does not have the purchases feature enabled (403)", async () => {
    const { accessToken } = await setupTenant(["purchases.read", "purchases.create"], false);

    await request(app.getHttpServer()).get("/purchases").set("Authorization", `Bearer ${accessToken}`).expect(403);
  });
});
