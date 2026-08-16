import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Suite test:tenant — copie conforme des autres modules Phase 8 : 404 (pas
// 403) sur une ressource d'un autre tenant, aucune fuite dans les listes, et
// un accountId d'un autre tenant dans une ligne d'écriture est rejeté (404),
// jamais scopé silencieusement.
describe("AccountingController — tenant isolation (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let accountingFeatureId: string;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);

    const feature = await prisma.feature.upsert({
      where: { key: "accounting" },
      create: { key: "accounting", label: "Comptabilité" },
      update: {},
    });
    accountingFeatureId = feature.id;
  });

  afterAll(async () => {
    await prisma.journalEntryLine.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.journalEntry.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.journalEntryCounter.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.account.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
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
        planFeatures: { create: { featureId: accountingFeatureId, enabled: true } },
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
    for (const key of ["accounting.read", "accounting.create"] as const) {
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

  async function createTwoAccounts(auth: { Authorization: string }) {
    const bankRes = await request(app.getHttpServer()).post("/accounting/accounts").set(auth).send({ code: "521000", label: "Banque" }).expect(201);
    const salesRes = await request(app.getHttpServer()).post("/accounting/accounts").set(auth).send({ code: "701000", label: "Ventes" }).expect(201);
    return { bankId: bankRes.body.id as string, salesId: salesRes.body.id as string };
  }

  it("returns 404 (not 403) when reading another tenant's account by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");
    const authB = { Authorization: `Bearer ${tenantB.accessToken}` };

    const accountRes = await request(app.getHttpServer()).post("/accounting/accounts").set(authB).send({ code: "601000", label: "Achats" }).expect(201);

    await request(app.getHttpServer())
      .get(`/accounting/accounts/${accountRes.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's accounts from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");
    const authA = { Authorization: `Bearer ${tenantA.accessToken}` };
    const authB = { Authorization: `Bearer ${tenantB.accessToken}` };

    const accountA = await request(app.getHttpServer()).post("/accounting/accounts").set(authA).send({ code: "601000", label: "Achats A" }).expect(201);
    await request(app.getHttpServer()).post("/accounting/accounts").set(authB).send({ code: "601000", label: "Achats B" }).expect(201);

    const listA = await request(app.getHttpServer()).get("/accounting/accounts").set(authA).expect(200);
    const ids = listA.body.items.map((a: { id: string }) => a.id);
    expect(ids).toContain(accountA.body.id);
    expect(ids).toHaveLength(1);
  });

  it("returns 404 (not 403) when reading another tenant's journal entry by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A Entry");
    const tenantB = await setupAdmin("Tenant B Entry");
    const authB = { Authorization: `Bearer ${tenantB.accessToken}` };
    const { bankId, salesId } = await createTwoAccounts(authB);

    const entryRes = await request(app.getHttpServer())
      .post("/accounting/journal-entries")
      .set(authB)
      .send({
        description: "Vente B",
        lines: [
          { accountId: bankId, debitAmount: 1_000, creditAmount: 0 },
          { accountId: salesId, debitAmount: 0, creditAmount: 1_000 },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/accounting/journal-entries/${entryRes.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("rejects a journal entry line referencing another tenant's accountId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Account");
    const tenantB = await setupAdmin("Tenant B Forge Account");
    const authA = { Authorization: `Bearer ${tenantA.accessToken}` };
    const authB = { Authorization: `Bearer ${tenantB.accessToken}` };

    const { bankId: bankA } = await createTwoAccounts(authA);
    const { salesId: salesB } = await createTwoAccounts(authB);

    await request(app.getHttpServer())
      .post("/accounting/journal-entries")
      .set(authA)
      .send({
        description: "Tentative cross-tenant",
        lines: [
          { accountId: bankA, debitAmount: 1_000, creditAmount: 0 },
          { accountId: salesB, debitAmount: 0, creditAmount: 1_000 },
        ],
      })
      .expect(404);

    const entries = await prisma.journalEntry.findMany({ where: { enterpriseId: tenantA.enterpriseId } });
    expect(entries).toHaveLength(0);
  });
});
