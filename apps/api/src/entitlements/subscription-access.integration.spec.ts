import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { SubscriptionStatus } from "@prisma/client";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "../auth/password.service";

// Phase 4, critère "abonnement expiré → accès en lecture seule ou blocage,
// testé" (docs/PROMPT-MAITRE-SAAS.md). Politique retenue : seul un abonnement
// EXPIRED/SUSPENDED/CANCELLED bloque les écritures — pas l'absence
// d'abonnement (voir entitlements/guards/subscription-access.guard.ts, et
// pourquoi : avant la Phase 6, une entreprise sans Subscription du tout ne
// doit pas se retrouver bloquée, ce n'est pas un abonnement expiré).
describe("SubscriptionAccessGuard (integration)", () => {
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
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  // Un ADMIN avec users.manage, sur un abonnement au statut donné (ou aucun
  // abonnement si status est undefined). Retourne un accessToken prêt à l'emploi.
  async function setupAdmin(status?: SubscriptionStatus) {
    const enterprise = await prisma.enterprise.create({ data: { name: `Sub Access Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    if (status) {
      const plan = await prisma.plan.create({
        data: { code: `PLAN_${randomUUID()}`, name: "Plan de test", priceMonthly: 5_000 },
      });
      createdPlanIds.push(plan.id);
      const subscription = await prisma.subscription.create({
        data: { enterpriseId: enterprise.id, planId: plan.id, status, startDate: new Date() },
      });
      await prisma.enterprise.update({
        where: { id: enterprise.id },
        data: { currentSubscriptionId: subscription.id },
      });
    }

    const role = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "ADMIN" } });
    const permission = await prisma.permission.upsert({
      where: { key: "users.manage" },
      create: { key: "users.manage" },
      update: {},
    });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });

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
    await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: admin.email, password })
      .expect(200);

    return { enterpriseId: enterprise.id, accessToken: loginRes.body.accessToken as string, roleId: role.id };
  }

  it.each([SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE])(
    "allows a write (invite) when the subscription is %s",
    async (status) => {
      const { accessToken, roleId } = await setupAdmin(status);

      await request(app.getHttpServer())
        .post("/users/invite")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ email: `invitee-${randomUUID()}@test.local`, firstName: "In", lastName: "Vitee", roleId })
        .expect(201);
    },
  );

  it.each([SubscriptionStatus.EXPIRED, SubscriptionStatus.SUSPENDED, SubscriptionStatus.CANCELLED])(
    "blocks a write (invite) when the subscription is %s, but GET /auth/me still works",
    async (status) => {
      const { accessToken, roleId } = await setupAdmin(status);

      await request(app.getHttpServer())
        .post("/users/invite")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ email: `invitee-${randomUUID()}@test.local`, firstName: "In", lastName: "Vitee", roleId })
        .expect(403);

      await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);
    },
  );

  it("does not block a write when the enterprise has no subscription at all (not yet provisioned, Phase 6)", async () => {
    const { accessToken, roleId } = await setupAdmin();

    await request(app.getHttpServer())
      .post("/users/invite")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ email: `invitee-${randomUUID()}@test.local`, firstName: "In", lastName: "Vitee", roleId })
      .expect(201);
  });
});
