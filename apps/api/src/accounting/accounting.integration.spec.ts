import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { PermissionKey } from "@erp/permissions";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Module 8 de la Phase 8, miroir de sales.integration.spec.ts et consorts.
// Contrairement aux modules précédents, deux ressources HTTP distinctes
// (accounting/accounts, accounting/journal-entries) partagent une seule
// feature/un seul groupe de permissions ("accounting").
describe("AccountingController (integration)", () => {
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

  async function setupTenant(permissions: PermissionKey[], accountingFeatureEnabled = true) {
    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        planFeatures: { create: { featureId: accountingFeatureId, enabled: accountingFeatureEnabled } },
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `Accounting Test ${randomUUID()}` } });
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

  it("supports the full lifecycle: create accounts, rename one, post a balanced entry, read the trial balance", async () => {
    const { accessToken } = await setupTenant(["accounting.read", "accounting.create", "accounting.update"]);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const bankRes = await request(app.getHttpServer())
      .post("/accounting/accounts")
      .set(auth)
      .send({ code: "521000", label: "Banque" })
      .expect(201);
    const salesRes = await request(app.getHttpServer())
      .post("/accounting/accounts")
      .set(auth)
      .send({ code: "701000", label: "Ventes" })
      .expect(201);

    const renameRes = await request(app.getHttpServer())
      .patch(`/accounting/accounts/${bankRes.body.id}`)
      .set(auth)
      .send({ label: "Banque BICIS" })
      .expect(200);
    expect(renameRes.body.label).toBe("Banque BICIS");
    expect(renameRes.body.code).toBe("521000");

    const entryRes = await request(app.getHttpServer())
      .post("/accounting/journal-entries")
      .set(auth)
      .send({
        description: "Vente au comptant",
        lines: [
          { accountId: bankRes.body.id, debitAmount: 15_000, creditAmount: 0 },
          { accountId: salesRes.body.id, debitAmount: 0, creditAmount: 15_000 },
        ],
      })
      .expect(201);
    expect(entryRes.body.totalDebit).toBe(15_000);
    expect(entryRes.body.totalCredit).toBe(15_000);

    const getEntryRes = await request(app.getHttpServer())
      .get(`/accounting/journal-entries/${entryRes.body.id}`)
      .set(auth)
      .expect(200);
    expect(getEntryRes.body.lines).toHaveLength(2);

    const listRes = await request(app.getHttpServer()).get("/accounting/journal-entries").set(auth).expect(200);
    expect(listRes.body.items.map((e: { id: string }) => e.id)).toContain(entryRes.body.id);

    const trialBalanceRes = await request(app.getHttpServer()).get("/accounting/trial-balance").set(auth).expect(200);
    expect(trialBalanceRes.body.totalDebit).toBe(15_000);
    expect(trialBalanceRes.body.totalCredit).toBe(15_000);
    const bankBalance = trialBalanceRes.body.accounts.find((a: { code: string }) => a.code === "521000");
    expect(bankBalance.balance).toBe(15_000);
  });

  // Régression MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) — même patron
  // que sales.integration.spec.ts.
  it("returns the same entry on a replayed POST /accounting/journal-entries carrying the same Idempotency-Key header", async () => {
    const { accessToken } = await setupTenant(["accounting.create", "accounting.read"]);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const bankRes = await request(app.getHttpServer())
      .post("/accounting/accounts")
      .set(auth)
      .send({ code: "521000", label: "Banque" })
      .expect(201);
    const salesRes = await request(app.getHttpServer())
      .post("/accounting/accounts")
      .set(auth)
      .send({ code: "701000", label: "Ventes" })
      .expect(201);
    const idempotencyKey = randomUUID();
    const body = {
      description: "Vente au comptant",
      lines: [
        { accountId: bankRes.body.id, debitAmount: 2_000, creditAmount: 0 },
        { accountId: salesRes.body.id, debitAmount: 0, creditAmount: 2_000 },
      ],
    };

    const firstRes = await request(app.getHttpServer())
      .post("/accounting/journal-entries")
      .set(auth)
      .set("Idempotency-Key", idempotencyKey)
      .send(body)
      .expect(201);

    const secondRes = await request(app.getHttpServer())
      .post("/accounting/journal-entries")
      .set(auth)
      .set("Idempotency-Key", idempotencyKey)
      .send(body)
      .expect(201);

    expect(secondRes.body.id).toBe(firstRes.body.id);
    expect(secondRes.body.number).toBe(firstRes.body.number);

    const listRes = await request(app.getHttpServer()).get("/accounting/journal-entries").set(auth).expect(200);
    const matching = listRes.body.items.filter((e: { id: string }) => e.id === firstRes.body.id);
    expect(matching).toHaveLength(1);
  });

  it("rejects creating an account with a code already used in the same tenant (409)", async () => {
    const { accessToken } = await setupTenant(["accounting.create"]);
    const auth = { Authorization: `Bearer ${accessToken}` };

    await request(app.getHttpServer()).post("/accounting/accounts").set(auth).send({ code: "601000", label: "Achats" }).expect(201);
    await request(app.getHttpServer()).post("/accounting/accounts").set(auth).send({ code: "601000", label: "Doublon" }).expect(409);
  });

  it("rejects an invalid account code (not numeric SYSCOHADA format) (400)", async () => {
    const { accessToken } = await setupTenant(["accounting.create"]);

    await request(app.getHttpServer())
      .post("/accounting/accounts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "ABC", label: "Compte invalide" })
      .expect(400);
  });

  it("rejects an unbalanced journal entry (400), before it ever reaches the repository", async () => {
    const { accessToken } = await setupTenant(["accounting.create"]);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const bankRes = await request(app.getHttpServer()).post("/accounting/accounts").set(auth).send({ code: "521000", label: "Banque" }).expect(201);
    const salesRes = await request(app.getHttpServer()).post("/accounting/accounts").set(auth).send({ code: "701000", label: "Ventes" }).expect(201);

    await request(app.getHttpServer())
      .post("/accounting/journal-entries")
      .set(auth)
      .send({
        description: "Écriture déséquilibrée",
        lines: [
          { accountId: bankRes.body.id, debitAmount: 10_000, creditAmount: 0 },
          { accountId: salesRes.body.id, debitAmount: 0, creditAmount: 9_000 },
        ],
      })
      .expect(400);
  });

  it("rejects a line carrying both a debit and a credit (400)", async () => {
    const { accessToken } = await setupTenant(["accounting.create"]);
    const auth = { Authorization: `Bearer ${accessToken}` };

    const bankRes = await request(app.getHttpServer()).post("/accounting/accounts").set(auth).send({ code: "521000", label: "Banque" }).expect(201);
    const salesRes = await request(app.getHttpServer()).post("/accounting/accounts").set(auth).send({ code: "701000", label: "Ventes" }).expect(201);

    await request(app.getHttpServer())
      .post("/accounting/journal-entries")
      .set(auth)
      .send({
        description: "Ligne invalide",
        lines: [
          { accountId: bankRes.body.id, debitAmount: 10_000, creditAmount: 10_000 },
          { accountId: salesRes.body.id, debitAmount: 0, creditAmount: 10_000 },
        ],
      })
      .expect(400);
  });

  it("rejects without the matching accounting.* permission (403)", async () => {
    const { accessToken } = await setupTenant(["accounting.read"]); // pas accounting.create

    await request(app.getHttpServer())
      .post("/accounting/accounts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ code: "601000", label: "Achats" })
      .expect(403);
  });

  it("rejects every route when the plan does not have the accounting feature enabled (403)", async () => {
    const { accessToken } = await setupTenant(["accounting.read", "accounting.create"], false);

    await request(app.getHttpServer()).get("/accounting/accounts").set("Authorization", `Bearer ${accessToken}`).expect(403);
  });
});
