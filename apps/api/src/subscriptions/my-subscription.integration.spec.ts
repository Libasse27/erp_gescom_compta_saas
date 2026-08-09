import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "../auth/password.service";

// Phase 7.2 : GET /subscriptions/me, lecture seule tenant-scoped pour la
// page Abonnement de l'espace entreprise.
describe("MySubscriptionController — GET /subscriptions/me (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);
  });

  afterAll(async () => {
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  async function setupEnterpriseAdmin(withSubscription: boolean) {
    const enterprise = await prisma.enterprise.create({ data: { name: `My Sub Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    if (withSubscription) {
      const limit = await prisma.limit.upsert({
        where: { key: "users" },
        create: { key: "users", label: "Utilisateurs" },
        update: {},
      });
      const plan = await prisma.plan.create({
        data: {
          code: `PLAN_${randomUUID()}`,
          name: "Plan de test",
          priceMonthly: 25_000,
          priceYearly: 250_000,
          planLimits: { create: { limitId: limit.id, value: 5 } },
        },
      });
      createdPlanIds.push(plan.id);

      const subscription = await prisma.subscription.create({
        data: { enterpriseId: enterprise.id, planId: plan.id, status: "TRIAL", startDate: new Date(), trialEndDate: new Date(Date.now() + 86_400_000) },
      });
      await prisma.enterprise.update({ where: { id: enterprise.id }, data: { currentSubscriptionId: subscription.id } });
    }

    const password = "AdminPassword9!";
    const admin = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Admin",
        lastName: "Test",
        enterpriseId: enterprise.id,
        status: "ACTIVE",
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: admin.email, password })
      .expect(200);

    return { accessToken: loginRes.body.accessToken as string };
  }

  it("returns the current plan/subscription details", async () => {
    const { accessToken } = await setupEnterpriseAdmin(true);

    const res = await request(app.getHttpServer())
      .get("/subscriptions/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.status).toBe("TRIAL");
    expect(res.body.priceMonthly).toBe(25_000);
    expect(res.body.maxUsers).toBe(5);
    expect(res.body.trialEndDate).not.toBeNull();
  });

  it("returns 404 when the enterprise has no subscription", async () => {
    const { accessToken } = await setupEnterpriseAdmin(false);

    await request(app.getHttpServer())
      .get("/subscriptions/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(404);
  });

  it("rejects without authentication (401)", async () => {
    await request(app.getHttpServer()).get("/subscriptions/me").expect(401);
  });
});
