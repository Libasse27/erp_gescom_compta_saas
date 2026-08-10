import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PermissionKey } from "@erp/permissions";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "../auth/password.service";

// Module 3 de la Phase 8 : copie conforme de suppliers.integration.spec.ts —
// CRUD nominal, validation d'entrée, permission manquante (403) et feature
// de plan désactivée (403), plus le conflit de code produit (409, propre à
// ce module). L'isolation tenant vit dans products.tenant.spec.ts.
describe("ProductsController (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let productsFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);

    const feature = await prisma.feature.upsert({
      where: { key: "products" },
      create: { key: "products", label: "Produits" },
      update: {},
    });
    productsFeatureId = feature.id;
  });

  afterAll(async () => {
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

  async function setupTenant(permissions: PermissionKey[], productsFeatureEnabled = true) {
    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        planFeatures: { create: { featureId: productsFeatureId, enabled: productsFeatureEnabled } },
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `Products Test ${randomUUID()}` } });
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

  it("supports the full CRUD lifecycle for a caller with all products.* permissions", async () => {
    const { accessToken } = await setupTenant(["products.read", "products.create", "products.update", "products.delete"]);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const createRes = await request(app.getHttpServer())
      .post("/products")
      .set(auth)
      .send({ code: `SKU-${randomUUID()}`, name: "Riz brisé 25kg", sellingPriceExcludingTax: 15_000 })
      .expect(201);
    expect(createRes.body.name).toBe("Riz brisé 25kg");
    expect(createRes.body.unit).toBe("pièce"); // valeur par défaut du schéma
    expect(createRes.body.vatRateBasisPoints).toBe(1_800);
    expect(createRes.body.isActive).toBe(true);
    const productId = createRes.body.id as string;

    const getRes = await request(app.getHttpServer()).get(`/products/${productId}`).set(auth).expect(200);
    expect(getRes.body.id).toBe(productId);

    const listRes = await request(app.getHttpServer()).get("/products").set(auth).expect(200);
    expect(listRes.body.items.map((p: { id: string }) => p.id)).toContain(productId);
    expect(listRes.body.total).toBeGreaterThanOrEqual(1);

    const updateRes = await request(app.getHttpServer())
      .patch(`/products/${productId}`)
      .set(auth)
      .send({ sellingPriceExcludingTax: 16_000 })
      .expect(200);
    expect(updateRes.body.sellingPriceExcludingTax).toBe(16_000);
    expect(updateRes.body.name).toBe("Riz brisé 25kg"); // update partiel : le reste est préservé

    await request(app.getHttpServer()).delete(`/products/${productId}`).set(auth).expect(200);

    const afterDelete = await request(app.getHttpServer()).get(`/products/${productId}`).set(auth).expect(200);
    expect(afterDelete.body.isActive).toBe(false); // suppression logique, pas physique
  });

  it("rejects creation with invalid input (400)", async () => {
    const { accessToken } = await setupTenant(["products.create"]);

    await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: `SKU-${randomUUID()}`, sellingPriceExcludingTax: 1_000 }) // name manquant
      .expect(400);

    await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: `SKU-${randomUUID()}`, name: "Sans prix" }) // sellingPriceExcludingTax manquant
      .expect(400);
  });

  it("rejects a duplicate product code within the same tenant (409)", async () => {
    const { accessToken } = await setupTenant(["products.create"]);
    const auth = { Authorization: `Bearer ${accessToken}` };
    const code = `SKU-${randomUUID()}`;

    await request(app.getHttpServer())
      .post("/products")
      .set(auth)
      .send({ code, name: "Premier", sellingPriceExcludingTax: 1_000 })
      .expect(201);

    await request(app.getHttpServer())
      .post("/products")
      .set(auth)
      .send({ code, name: "Second", sellingPriceExcludingTax: 2_000 })
      .expect(409);
  });

  it("filters the list by ?isActive=false without inverting the filter", async () => {
    const { accessToken } = await setupTenant(["products.read", "products.create", "products.delete"]);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const active = await request(app.getHttpServer())
      .post("/products")
      .set(auth)
      .send({ code: `SKU-${randomUUID()}`, name: "Actif", sellingPriceExcludingTax: 1_000 })
      .expect(201);
    const inactive = await request(app.getHttpServer())
      .post("/products")
      .set(auth)
      .send({ code: `SKU-${randomUUID()}`, name: "À désactiver", sellingPriceExcludingTax: 1_000 })
      .expect(201);
    await request(app.getHttpServer()).delete(`/products/${inactive.body.id}`).set(auth).expect(200);

    const inactiveOnly = await request(app.getHttpServer())
      .get("/products")
      .query({ isActive: "false" })
      .set(auth)
      .expect(200);
    const ids = inactiveOnly.body.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(inactive.body.id);
    expect(ids).not.toContain(active.body.id);

    const activeOnly = await request(app.getHttpServer())
      .get("/products")
      .query({ isActive: "true" })
      .set(auth)
      .expect(200);
    const activeIds = activeOnly.body.items.map((p: { id: string }) => p.id);
    expect(activeIds).toContain(active.body.id);
    expect(activeIds).not.toContain(inactive.body.id);
  });

  it("rejects without the matching products.* permission (403)", async () => {
    const { accessToken } = await setupTenant(["products.read"]); // pas products.create

    await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: `SKU-${randomUUID()}`, name: "Sans Permission", sellingPriceExcludingTax: 1_000 })
      .expect(403);
  });

  it("rejects every route when the plan does not have the products feature enabled (403)", async () => {
    const { accessToken } = await setupTenant(
      ["products.read", "products.create", "products.update", "products.delete"],
      false,
    );

    await request(app.getHttpServer()).get("/products").set("Authorization", `Bearer ${accessToken}`).expect(403);

    await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: `SKU-${randomUUID()}`, name: "Feature Désactivée", sellingPriceExcludingTax: 1_000 })
      .expect(403);
  });
});
