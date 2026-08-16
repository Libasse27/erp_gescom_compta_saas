import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Phase 4, critère "dépassement de quota (utilisateurs...) → erreur
// explicite côté API, testée" (docs/PROMPT-MAITRE-SAAS.md). Seule la limite
// "users" est exerçable aujourd'hui (aucun module ERP — produits, clients —
// n'existe avant la Phase 8) : POST /users/invite est le seul endpoint
// d'écriture soumis à @WithinLimit.
describe("LimitGuard — quota utilisateurs (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
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
    // Le catalogue Limit("users") n'est jamais supprimé, comme la Permission
    // "users.manage" upsertée par d'autres suites : ce sont des lignes de
    // référence plateforme partagées entre suites de test exécutées en
    // parallèle, pas des fixtures propres à ce fichier.
    await app.close();
  });

  // Une entreprise ACTIVE sur un plan dont la limite "users" vaut maxUsers
  // (undefined => aucune ligne PlanLimit, donc illimité). Retourne
  // l'accessToken de l'ADMIN et le roleId à utiliser pour inviter.
  async function setupEnterprise(maxUsers?: number) {
    const enterprise = await prisma.enterprise.create({ data: { name: `Limit Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    let limitId: string | undefined;
    if (maxUsers !== undefined) {
      const limit = await prisma.limit.upsert({
        where: { key: "users" },
        create: { key: "users", label: "Utilisateurs" },
        update: {},
      });
      limitId = limit.id;
    }

    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        ...(limitId ? { planLimits: { create: { limitId, value: maxUsers } } } : {}),
      },
    });
    createdPlanIds.push(plan.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: "ACTIVE", startDate: new Date() },
    });
    await prisma.enterprise.update({
      where: { id: enterprise.id },
      data: { currentSubscriptionId: subscription.id },
    });

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

    return { accessToken: loginRes.body.accessToken as string, roleId: role.id };
  }

  function inviteRequest(accessToken: string, roleId: string) {
    return request(app.getHttpServer())
      .post("/users/invite")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ email: `invitee-${randomUUID()}@test.local`, firstName: "In", lastName: "Vitee", roleId });
  }

  it("blocks a new invitation once the plan's users quota is reached", async () => {
    // maxUsers=1 : l'ADMIN seed compte déjà pour 1 → le quota est atteint
    // avant la moindre invitation.
    const { accessToken, roleId } = await setupEnterprise(1);

    await inviteRequest(accessToken, roleId).expect(403);
  });

  it("allows invitations while under the plan's users quota, then blocks once reached", async () => {
    const { accessToken, roleId } = await setupEnterprise(2);

    // 1 ADMIN existant + cette invitation = 2 => encore dans la limite.
    await inviteRequest(accessToken, roleId).expect(201);
    // La 2e invitation porterait l'effectif à 3 => quota dépassé.
    await inviteRequest(accessToken, roleId).expect(403);
  });

  it("does not restrict invitations when the plan has no PlanLimit for 'users' (unlimited)", async () => {
    const { accessToken, roleId } = await setupEnterprise();

    await inviteRequest(accessToken, roleId).expect(201);
    await inviteRequest(accessToken, roleId).expect(201);
  });
});
