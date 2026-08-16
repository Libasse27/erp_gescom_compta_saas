import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Phase 7.4 : GET/PATCH /onboarding, assistant post-inscription (étapes 5-7,
// les étapes 1-4 étant déjà couvertes par le provisioning, Phase 6).
describe("OnboardingController — /onboarding (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);
  });

  afterAll(async () => {
    await prisma.onboardingState.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await app.close();
  });

  async function setupEnterpriseAdmin() {
    const enterprise = await prisma.enterprise.create({ data: { name: `Onboarding Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

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

    return { enterprise, accessToken: loginRes.body.accessToken as string };
  }

  it("creates the state lazily on first read and returns the real checklist", async () => {
    const { accessToken } = await setupEnterpriseAdmin();

    const res = await request(app.getHttpServer())
      .get("/onboarding")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.currentStep).toBe(5);
    expect(res.body.completedAt).toBeNull();

    const byKey = Object.fromEntries(res.body.checklist.map((item: { key: string }) => [item.key, item]));
    expect(byKey.enterprise_created.done).toBe(true);
    expect(byKey.first_user_added.done).toBe(true);
    // Aucun abonnement lié dans ce test (provisioning non rejoué) : le fait dérivé reflète la réalité.
    expect(byKey.plan_activated.done).toBe(false);
    expect(byKey.first_client.available).toBe(false);
    expect(byKey.first_client.reason).toBe("phase_8");
  });

  it("advances the current step and is idempotent across repeated reads", async () => {
    const { accessToken } = await setupEnterpriseAdmin();

    await request(app.getHttpServer())
      .patch("/onboarding")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ step: 6 })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get("/onboarding")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.currentStep).toBe(6);
  });

  it("rejects moving the step backward", async () => {
    const { accessToken } = await setupEnterpriseAdmin();

    await request(app.getHttpServer())
      .patch("/onboarding")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ step: 7 })
      .expect(200);

    await request(app.getHttpServer())
      .patch("/onboarding")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ step: 6 })
      .expect(400);
  });

  it("marks the onboarding as completed", async () => {
    const { accessToken } = await setupEnterpriseAdmin();

    const res = await request(app.getHttpServer())
      .patch("/onboarding")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ completed: true })
      .expect(200);

    expect(res.body.completedAt).not.toBeNull();
  });

  it("rejects an empty PATCH body (400)", async () => {
    const { accessToken } = await setupEnterpriseAdmin();

    await request(app.getHttpServer())
      .patch("/onboarding")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({})
      .expect(400);
  });

  it("rejects without authentication (401)", async () => {
    await request(app.getHttpServer()).get("/onboarding").expect(401);
    await request(app.getHttpServer()).patch("/onboarding").send({ step: 6 }).expect(401);
  });
});
