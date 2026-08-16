import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PermissionKey } from "@erp/permissions";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Module 2 de la Phase 8 : copie conforme de customers.integration.spec.ts —
// CRUD nominal, validation d'entrée, permission manquante (403) et feature
// de plan désactivée (403). L'isolation tenant vit dans suppliers.tenant.spec.ts.
describe("SuppliersController (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let suppliersFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);

    const feature = await prisma.feature.upsert({
      where: { key: "suppliers" },
      create: { key: "suppliers", label: "Fournisseurs" },
      update: {},
    });
    suppliersFeatureId = feature.id;
  });

  afterAll(async () => {
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

  async function setupTenant(permissions: PermissionKey[], suppliersFeatureEnabled = true) {
    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        planFeatures: { create: { featureId: suppliersFeatureId, enabled: suppliersFeatureEnabled } },
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `Suppliers Test ${randomUUID()}` } });
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

  it("supports the full CRUD lifecycle for a caller with all suppliers.* permissions", async () => {
    const { accessToken } = await setupTenant([
      "suppliers.read",
      "suppliers.create",
      "suppliers.update",
      "suppliers.delete",
    ]);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const createRes = await request(app.getHttpServer())
      .post("/suppliers")
      .set(auth)
      .send({ type: "COMPANY", name: "Import Export Sénégal SARL", email: "contact@importexport.sn" })
      .expect(201);
    expect(createRes.body.name).toBe("Import Export Sénégal SARL");
    expect(createRes.body.isActive).toBe(true);
    const supplierId = createRes.body.id as string;

    const getRes = await request(app.getHttpServer()).get(`/suppliers/${supplierId}`).set(auth).expect(200);
    expect(getRes.body.id).toBe(supplierId);

    const listRes = await request(app.getHttpServer()).get("/suppliers").set(auth).expect(200);
    expect(listRes.body.items.map((s: { id: string }) => s.id)).toContain(supplierId);
    expect(listRes.body.total).toBeGreaterThanOrEqual(1);

    const updateRes = await request(app.getHttpServer())
      .patch(`/suppliers/${supplierId}`)
      .set(auth)
      .send({ phone: "+221771234567" })
      .expect(200);
    expect(updateRes.body.phone).toBe("+221771234567");
    expect(updateRes.body.name).toBe("Import Export Sénégal SARL"); // update partiel : le reste est préservé

    await request(app.getHttpServer()).delete(`/suppliers/${supplierId}`).set(auth).expect(200);

    const afterDelete = await request(app.getHttpServer()).get(`/suppliers/${supplierId}`).set(auth).expect(200);
    expect(afterDelete.body.isActive).toBe(false); // suppression logique, pas physique
  });

  it("rejects creation with invalid input (400)", async () => {
    const { accessToken } = await setupTenant(["suppliers.create"]);

    await request(app.getHttpServer())
      .post("/suppliers")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ type: "COMPANY", email: "not-an-email" }) // name manquant
      .expect(400);
  });

  it("filters the list by ?isActive=false without inverting the filter", async () => {
    const { accessToken } = await setupTenant(["suppliers.read", "suppliers.create", "suppliers.delete"]);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const active = await request(app.getHttpServer())
      .post("/suppliers")
      .set(auth)
      .send({ type: "COMPANY", name: "Actif SARL" })
      .expect(201);
    const inactive = await request(app.getHttpServer())
      .post("/suppliers")
      .set(auth)
      .send({ type: "COMPANY", name: "À désactiver SARL" })
      .expect(201);
    await request(app.getHttpServer()).delete(`/suppliers/${inactive.body.id}`).set(auth).expect(200);

    const inactiveOnly = await request(app.getHttpServer())
      .get("/suppliers")
      .query({ isActive: "false" })
      .set(auth)
      .expect(200);
    const ids = inactiveOnly.body.items.map((s: { id: string }) => s.id);
    expect(ids).toContain(inactive.body.id);
    expect(ids).not.toContain(active.body.id);

    const activeOnly = await request(app.getHttpServer())
      .get("/suppliers")
      .query({ isActive: "true" })
      .set(auth)
      .expect(200);
    const activeIds = activeOnly.body.items.map((s: { id: string }) => s.id);
    expect(activeIds).toContain(active.body.id);
    expect(activeIds).not.toContain(inactive.body.id);
  });

  it("rejects without the matching suppliers.* permission (403)", async () => {
    const { accessToken } = await setupTenant(["suppliers.read"]); // pas suppliers.create

    await request(app.getHttpServer())
      .post("/suppliers")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ type: "COMPANY", name: "Sans Permission SARL" })
      .expect(403);
  });

  it("rejects every route when the plan does not have the suppliers feature enabled (403)", async () => {
    const { accessToken } = await setupTenant(
      ["suppliers.read", "suppliers.create", "suppliers.update", "suppliers.delete"],
      false,
    );

    await request(app.getHttpServer())
      .get("/suppliers")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post("/suppliers")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ type: "COMPANY", name: "Feature Désactivée SARL" })
      .expect(403);
  });
});
