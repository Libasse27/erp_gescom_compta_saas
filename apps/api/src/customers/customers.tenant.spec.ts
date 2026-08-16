import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Suite test:tenant — critères Phase 3 appliqués au premier endpoint de liste
// tenant jamais construit (docs/PROMPT-MAITRE-SAAS.md §E, tests 1 et 2) :
// GET /customers/:id d'un autre tenant => 404 (pas 403), GET /customers ne
// retourne jamais les clients d'un autre tenant, et un enterpriseId forgé
// dans le corps d'une requête est sans effet.
describe("CustomersController — tenant isolation (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let clientsFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);

    const feature = await prisma.feature.upsert({
      where: { key: "clients" },
      create: { key: "clients", label: "Clients" },
      update: {},
    });
    clientsFeatureId = feature.id;
  });

  afterAll(async () => {
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
        planFeatures: { create: { featureId: clientsFeatureId, enabled: true } },
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
    for (const key of ["clients.read", "clients.create"] as const) {
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

  it("returns 404 (not 403) when reading another tenant's customer by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");

    const created = await request(app.getHttpServer())
      .post("/customers")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ type: "COMPANY", name: "Client de B" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/customers/${created.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's customers from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");

    await request(app.getHttpServer())
      .post("/customers")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ type: "COMPANY", name: "Client de A" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/customers")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ type: "COMPANY", name: "Client de B" })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get("/customers")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    expect(listA.body.items.every((c: { name: string }) => c.name !== "Client de B")).toBe(true);
    expect(listA.body.items.some((c: { name: string }) => c.name === "Client de A")).toBe(true);
  });

  it("ignores a forged enterpriseId in the request body and scopes the created row to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge");
    const tenantB = await setupAdmin("Tenant B Forge");

    const created = await request(app.getHttpServer())
      .post("/customers")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ type: "COMPANY", name: "Tentative de forge", enterpriseId: tenantB.enterpriseId })
      .expect(201);

    const stored = await prisma.customer.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.enterpriseId).toBe(tenantA.enterpriseId);
  });
});
