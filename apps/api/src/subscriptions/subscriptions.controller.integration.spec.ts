import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { authenticator } from "otplib";
import { SubscriptionStatus } from "@prisma/client";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { MfaService } from "../auth/mfa.service";
import { CrossTenantRepository } from "../tenant/cross-tenant.repository";

// Phase 4, critère "changer un plan côté Super Admin se répercute sans
// redéploiement" (docs/PROMPT-MAITRE-SAAS.md) : PATCH /admin/enterprises/:id/subscription,
// premier usage de CrossTenantRepository (CLAUDE.md §5).
describe("SubscriptionsController — changement de plan Super Admin (integration)", () => {
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
    await prisma.subscriptionEvent.deleteMany({
      where: { subscription: { enterpriseId: { in: createdEnterpriseIds } } },
    });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.user.deleteMany({ where: { OR: [{ enterpriseId: { in: createdEnterpriseIds } }, { id: { in: createdUserIds } }] } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    // Catalogue partagé (permissions.users.manage, limits.users) : jamais
    // supprimé, voir entitlements/limit-guard.integration.spec.ts.
    await app.close();
  });

  async function createSuperAdminToken() {
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

  async function createEnterpriseAdminToken() {
    const enterprise = await prisma.enterprise.create({ data: { name: `Plan Change Test ${randomUUID()}` } });
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

    return { enterprise, adminId: admin.id, accessToken: loginRes.body.accessToken as string };
  }

  async function createPlan(code: string) {
    const plan = await prisma.plan.create({ data: { code, name: code, priceMonthly: 5_000 } });
    createdPlanIds.push(plan.id);
    return plan;
  }

  async function subscribeEnterprise(
    enterpriseId: string,
    planId: string,
    status: SubscriptionStatus = "ACTIVE",
  ) {
    const subscription = await prisma.subscription.create({
      data: { enterpriseId, planId, status, startDate: new Date() },
    });
    await prisma.enterprise.update({ where: { id: enterpriseId }, data: { currentSubscriptionId: subscription.id } });
    return subscription;
  }

  it("lets the Super Admin move an enterprise to a different plan, effective on the very next request", async () => {
    const superAdminToken = await createSuperAdminToken();
    const { enterprise } = await createEnterpriseAdminToken();
    const oldPlan = await createPlan(`OLD_${randomUUID()}`);
    const newPlan = await createPlan(`NEW_${randomUUID()}`);
    const subscription = await subscribeEnterprise(enterprise.id, oldPlan.id);

    await request(app.getHttpServer())
      .patch(`/admin/enterprises/${enterprise.id}/subscription`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ planId: newPlan.id, reason: "Upsell" })
      .expect(200);

    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.planId).toBe(newPlan.id);

    const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.fromPlanId).toBe(oldPlan.id);
    expect(events[0]!.toPlanId).toBe(newPlan.id);

    const auditLogs = await prisma.auditLog.findMany({
      where: { enterpriseId: enterprise.id, action: "CHANGE_PLAN" },
    });
    expect(auditLogs).toHaveLength(1);
  });

  it("rejects the same request from a non-Super-Admin (enterprise ADMIN)", async () => {
    const { enterprise, accessToken } = await createEnterpriseAdminToken();
    const plan = await createPlan(`PLAN_${randomUUID()}`);
    await subscribeEnterprise(enterprise.id, plan.id);
    const otherPlan = await createPlan(`OTHER_${randomUUID()}`);

    await request(app.getHttpServer())
      .patch(`/admin/enterprises/${enterprise.id}/subscription`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ planId: otherPlan.id })
      .expect(403);
  });

  it("returns 404 for an enterprise with no active subscription", async () => {
    const superAdminToken = await createSuperAdminToken();
    const enterprise = await prisma.enterprise.create({ data: { name: `No Sub ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    const plan = await createPlan(`PLAN_${randomUUID()}`);

    await request(app.getHttpServer())
      .patch(`/admin/enterprises/${enterprise.id}/subscription`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ planId: plan.id })
      .expect(404);
  });

  it("returns 409 when the enterprise is already on the requested plan", async () => {
    const superAdminToken = await createSuperAdminToken();
    const { enterprise } = await createEnterpriseAdminToken();
    const plan = await createPlan(`PLAN_${randomUUID()}`);
    await subscribeEnterprise(enterprise.id, plan.id);

    await request(app.getHttpServer())
      .patch(`/admin/enterprises/${enterprise.id}/subscription`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ planId: plan.id })
      .expect(409);
  });

  // BIL-13 (docs/audit/BILLING-AUDIT.md) : CANCELLED et EXPIRED sont des
  // états terminaux (subscription-state-machine.ts) — plus aucune écriture
  // n'y est autorisée, y compris un changement de plan.
  it.each(["CANCELLED", "EXPIRED"] as const)(
    "rejects the plan change and makes no change when the subscription is %s",
    async (status) => {
      const superAdminToken = await createSuperAdminToken();
      const { enterprise } = await createEnterpriseAdminToken();
      const oldPlan = await createPlan(`TERMINAL_OLD_${randomUUID()}`);
      const newPlan = await createPlan(`TERMINAL_NEW_${randomUUID()}`);
      const subscription = await subscribeEnterprise(enterprise.id, oldPlan.id, status);

      await request(app.getHttpServer())
        .patch(`/admin/enterprises/${enterprise.id}/subscription`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ planId: newPlan.id })
        .expect(409);

      const unchanged = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(unchanged.planId).toBe(oldPlan.id);

      const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id } });
      expect(events).toHaveLength(0);
    },
  );

  // BIL-13 : les deux écritures (Subscription.planId, SubscriptionEvent)
  // doivent réussir ou échouer ensemble. Un planId inexistant fait échouer
  // tx.subscription.update sur la contrainte de clé étrangère — si la
  // transaction fonctionne, aucune des deux écritures ne doit être visible.
  it("rolls back both writes together when the transaction fails (atomicity)", async () => {
    const { enterprise } = await createEnterpriseAdminToken();
    const plan = await createPlan(`ATOMIC_${randomUUID()}`);
    const subscription = await subscribeEnterprise(enterprise.id, plan.id);
    const crossTenant = app.get(CrossTenantRepository);

    await expect(
      crossTenant.changeSubscriptionPlan(subscription.id, randomUUID(), {
        fromStatus: SubscriptionStatus.ACTIVE,
        fromPlanId: plan.id,
        reason: "atomicity test",
      }),
    ).rejects.toThrow();

    const unchanged = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(unchanged.planId).toBe(plan.id);

    const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id } });
    expect(events).toHaveLength(0);
  });

  // BIL-17 (docs/audit/BILLING-AUDIT.md) : ce test ne prouvait auparavant
  // que le comportement en environnement de test (ENTITLEMENTS_CACHE_TTL_MS
  // forcé à 0, voir test/setup-env.js) — chaque appel se ré-résolvait de
  // toute façon, TTL positif ou non. Le TTL est ici explicitement mis à la
  // valeur par défaut de production (5000 ms) pour la portion du test qui
  // change de plan, afin de démontrer l'invalidation active de
  // SubscriptionsService.changePlan (EntitlementsService.invalidate) plutôt
  // qu'un TTL par ailleurs désactivé.
  it("takes effect immediately for entitlements checks, without redeploying anything, even with a production-like TTL", async () => {
    const previousTtl = process.env.ENTITLEMENTS_CACHE_TTL_MS;
    process.env.ENTITLEMENTS_CACHE_TTL_MS = "5000";
    try {
      const superAdminToken = await createSuperAdminToken();
      const { enterprise, adminId, accessToken } = await createEnterpriseAdminToken();

      const role = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "ADMIN" } });
      const permission = await prisma.permission.upsert({
        where: { key: "users.manage" },
        create: { key: "users.manage" },
        update: {},
      });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      await prisma.userRole.create({ data: { userId: adminId, roleId: role.id } });

      const roomyPlan = await createPlan(`ROOMY_${randomUUID()}`);
      await subscribeEnterprise(enterprise.id, roomyPlan.id);

      // Sur ce plan sans limite "users", l'invitation passe.
      await request(app.getHttpServer())
        .post("/users/invite")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ email: `invitee-${randomUUID()}@test.local`, firstName: "In", lastName: "Vitee", roleId: role.id })
        .expect(201);

      const limit = await prisma.limit.upsert({
        where: { key: "users" },
        create: { key: "users", label: "Utilisateurs" },
        update: {},
      });
      const tightPlan = await prisma.plan.create({
        data: {
          code: `TIGHT_${randomUUID()}`,
          name: "Tight",
          priceMonthly: 5_000,
          planLimits: { create: { limitId: limit.id, value: 1 } },
        },
      });
      createdPlanIds.push(tightPlan.id);

      await request(app.getHttpServer())
        .patch(`/admin/enterprises/${enterprise.id}/subscription`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ planId: tightPlan.id })
        .expect(200);

      // Sans redéploiement ni relogin : la toute prochaine requête voit déjà
      // le nouveau plan (2 utilisateurs existants >= limite de 1) — même
      // avec un TTL de production actif, grâce à invalidate() (BIL-17).
      await request(app.getHttpServer())
        .post("/users/invite")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ email: `invitee-${randomUUID()}@test.local`, firstName: "In", lastName: "Vitee", roleId: role.id })
        .expect(403);

      // Downgrade avec effectif au-delà du nouveau quota : les 2 utilisateurs
      // existants ne sont jamais supprimés (pas de perte silencieuse), seule
      // la création de nouveaux comptes est bloquée.
      const remainingUsers = await prisma.user.count({ where: { enterpriseId: enterprise.id } });
      expect(remainingUsers).toBe(2);
    } finally {
      process.env.ENTITLEMENTS_CACHE_TTL_MS = previousTtl;
    }
  });
});
