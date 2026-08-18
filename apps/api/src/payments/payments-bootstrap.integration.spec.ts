import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { authenticator } from "otplib";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { MfaService } from "../auth/mfa.service";

// BIL-05 (docs/audit/BILLING-AUDIT.md) : le montant d'un paiement amorcé par
// le Super Admin ne doit jamais venir du corps de la requête — il doit être
// recalculé côté serveur depuis le prix du plan de l'abonnement (CLAUDE.md §6).
describe("PaymentsBootstrapController (integration) — BIL-05", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let mfaService: MfaService;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);
    mfaService = app.get(MfaService);
  });

  afterAll(async () => {
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.payment.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.user.deleteMany({
      where: { OR: [{ enterpriseId: { in: createdEnterpriseIds } }, { id: { in: createdUserIds } }] },
    });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  async function createSuperAdminToken(): Promise<string> {
    const secret = mfaService.generateSecret();
    const plainPassword = "SuperSecretPassw0rd!";
    const user = await prisma.user.create({
      data: {
        email: `super-${randomUUID()}@platform.test`,
        passwordHash: await passwordService.hash(plainPassword),
        firstName: "Super",
        lastName: "Admin",
        isSuperAdmin: true,
        enterpriseId: null,
        status: "ACTIVE",
        mfaEnabled: true,
        mfaSecret: mfaService.encryptSecret(secret),
      },
    });
    createdUserIds.push(user.id);

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);
    const mfaRes = await request(app.getHttpServer())
      .post("/auth/mfa/verify")
      .send({ challengeToken: loginRes.body.challengeToken, code: authenticator.generate(secret) })
      .expect(200);

    return mfaRes.body.accessToken as string;
  }

  async function createEnterpriseWithSubscription(priceMonthly: number, priceYearly: number | null) {
    const enterprise = await prisma.enterprise.create({ data: { name: `BIL-05 Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const plan = await prisma.plan.create({
      data: { code: `PLAN_${randomUUID()}`, name: "Plan de test", priceMonthly, priceYearly },
    });
    createdPlanIds.push(plan.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: "TRIAL", startDate: new Date() },
    });
    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { currentSubscriptionId: subscription.id } });

    return { enterprise, plan, subscription };
  }

  it("ignores a forged amount/currency in the request body and derives the amount from the plan's monthly price", async () => {
    const superAdminToken = await createSuperAdminToken();
    const { enterprise } = await createEnterpriseWithSubscription(7_500, 75_000);

    const res = await request(app.getHttpServer())
      .post(`/admin/enterprises/${enterprise.id}/payments`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({
        provider: "WAVE",
        providerReference: `ref-${randomUUID()}`,
        billingPeriod: "MONTHLY",
        amount: 1,
        currency: "EUR",
      })
      .expect(201);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: res.body.paymentId } });
    expect(payment.amount).toBe(7_500);
    expect(payment.currency).toBe("XOF");
  });

  it("derives the amount from the plan's yearly price when billingPeriod is YEARLY", async () => {
    const superAdminToken = await createSuperAdminToken();
    const { enterprise } = await createEnterpriseWithSubscription(7_500, 75_000);

    const res = await request(app.getHttpServer())
      .post(`/admin/enterprises/${enterprise.id}/payments`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ provider: "WAVE", providerReference: `ref-${randomUUID()}`, billingPeriod: "YEARLY" })
      .expect(201);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: res.body.paymentId } });
    expect(payment.amount).toBe(75_000);
  });

  it("rejects YEARLY billing with 409 when the plan has no yearly price", async () => {
    const superAdminToken = await createSuperAdminToken();
    const { enterprise } = await createEnterpriseWithSubscription(7_500, null);

    await request(app.getHttpServer())
      .post(`/admin/enterprises/${enterprise.id}/payments`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ provider: "WAVE", providerReference: `ref-${randomUUID()}`, billingPeriod: "YEARLY" })
      .expect(409);
  });

  it("rejects a request missing billingPeriod with 400", async () => {
    const superAdminToken = await createSuperAdminToken();
    const { enterprise } = await createEnterpriseWithSubscription(7_500, 75_000);

    await request(app.getHttpServer())
      .post(`/admin/enterprises/${enterprise.id}/payments`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ provider: "WAVE", providerReference: `ref-${randomUUID()}` })
      .expect(400);
  });
});
