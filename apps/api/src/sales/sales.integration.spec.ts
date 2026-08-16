import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PermissionKey } from "@erp/permissions";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Module 5 de la Phase 8 : contrairement aux modules précédents (CRUD sur
// une fiche), pas de PATCH/DELETE ici — confirm/cancel sont les seules
// transitions. Clients et produits nécessaires aux tests sont insérés
// directement via `prisma` (rôle identité, contourne la RLS comme les
// modules Stock/Produits) : seule la feature "sales" est le sujet de ce
// module.
describe("SalesController (integration)", () => {
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
    await prisma.stockMovement.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
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

  async function setupTenant(permissions: PermissionKey[], salesFeatureEnabled = true) {
    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        planFeatures: { create: { featureId: salesFeatureId, enabled: salesFeatureEnabled } },
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `Sales Test ${randomUUID()}` } });
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

  function createCustomer(enterpriseId: string) {
    return prisma.customer.create({ data: { enterpriseId, type: "COMPANY", name: "Client test" } });
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

  it("supports the full lifecycle: create a DRAFT sale, then confirm it (stock decremented)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["sales.read", "sales.create", "sales.update"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const customer = await createCustomer(enterpriseId);
    const product = await createProduct(enterpriseId);
    await prisma.stockMovement.create({ data: { enterpriseId, productId: product.id, type: "IN", quantity: 10 } });

    const createRes = await request(app.getHttpServer())
      .post("/sales")
      .set(auth)
      .send({ customerId: customer.id, lines: [{ productId: product.id, quantity: 4 }] })
      .expect(201);
    expect(createRes.body.status).toBe("DRAFT");
    expect(createRes.body.totalExcludingTax).toBe(4_000);
    expect(createRes.body.totalIncludingTax).toBe(4_720);
    const saleId = createRes.body.id as string;

    const getRes = await request(app.getHttpServer()).get(`/sales/${saleId}`).set(auth).expect(200);
    expect(getRes.body.lines).toHaveLength(1);

    const listRes = await request(app.getHttpServer()).get("/sales").set(auth).expect(200);
    expect(listRes.body.items.map((s: { id: string }) => s.id)).toContain(saleId);

    const confirmRes = await request(app.getHttpServer()).post(`/sales/${saleId}/confirm`).set(auth).expect(201);
    expect(confirmRes.body.status).toBe("CONFIRMED");

    // Vérifié directement via prisma (pas via GET /stock/:id) : ce tenant n'a
    // que la feature "sales" activée, pas "stock" — l'effet de bord attendu
    // est la présence du mouvement OUT, pas l'accès HTTP au module Stock.
    const movements = await prisma.stockMovement.findMany({ where: { enterpriseId, productId: product.id } });
    const quantityOnHand = movements.reduce(
      (total, m) => total + (m.type === "OUT" ? -m.quantity : m.quantity),
      0,
    );
    expect(quantityOnHand).toBe(6); // 10 reçus - 4 vendus
  });

  it("rejects confirming a sale when stock is insufficient (409)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["sales.create", "sales.update"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const customer = await createCustomer(enterpriseId);
    const product = await createProduct(enterpriseId);

    const createRes = await request(app.getHttpServer())
      .post("/sales")
      .set(auth)
      .send({ customerId: customer.id, lines: [{ productId: product.id, quantity: 1 }] })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/sales/${createRes.body.id}/confirm`)
      .set(auth)
      .expect(409);
  });

  it("rejects invalid input (400): empty lines array", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["sales.create"]);
    const customer = await createCustomer(enterpriseId);

    await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ customerId: customer.id, lines: [] })
      .expect(400);
  });

  it("cancels a DRAFT sale but rejects cancelling an already-confirmed one (400)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["sales.create", "sales.update", "sales.delete"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const customer = await createCustomer(enterpriseId);
    const product = await createProduct(enterpriseId, false);

    const draftRes = await request(app.getHttpServer())
      .post("/sales")
      .set(auth)
      .send({ customerId: customer.id, lines: [{ productId: product.id, quantity: 1 }] })
      .expect(201);
    const cancelRes = await request(app.getHttpServer()).post(`/sales/${draftRes.body.id}/cancel`).set(auth).expect(201);
    expect(cancelRes.body.status).toBe("CANCELLED");

    const confirmedRes = await request(app.getHttpServer())
      .post("/sales")
      .set(auth)
      .send({ customerId: customer.id, lines: [{ productId: product.id, quantity: 1 }] })
      .expect(201);
    await request(app.getHttpServer()).post(`/sales/${confirmedRes.body.id}/confirm`).set(auth).expect(201);

    await request(app.getHttpServer()).post(`/sales/${confirmedRes.body.id}/cancel`).set(auth).expect(400);
  });

  it("rejects without the matching sales.* permission (403)", async () => {
    const { accessToken, enterpriseId } = await setupTenant(["sales.read"]); // pas sales.create
    const customer = await createCustomer(enterpriseId);

    await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ customerId: customer.id, lines: [{ productId: randomUUID(), quantity: 1 }] })
      .expect(403);
  });

  it("rejects every route when the plan does not have the sales feature enabled (403)", async () => {
    const { accessToken } = await setupTenant(["sales.read", "sales.create"], false);

    await request(app.getHttpServer()).get("/sales").set("Authorization", `Bearer ${accessToken}`).expect(403);
  });
});
