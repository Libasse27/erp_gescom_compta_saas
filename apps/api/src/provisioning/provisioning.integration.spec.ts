import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { DEFAULT_ROLE_NAMES, DEFAULT_ROLE_PERMISSIONS } from "@erp/permissions";
import { SYSCOHADA_ACCOUNT_CLASSES } from "./syscohada-chart-of-accounts";
import { AccountRecoveryService } from "../auth/account-recovery.service";
import { NotificationsService } from "../notifications/notifications.service";
import { AuthService } from "../auth/auth.service";
import { TokenService } from "../auth/token.service";
import { MAIL_SENDER, MailMessage, MailSender } from "../notifications/mail-sender";

// BIL-11 (docs/audit/BILLING-AUDIT.md) : capture ce qui est réellement
// envoyé, indépendamment de ce qui est persisté dans `Notification.body` —
// même patron que invitations.integration.spec.ts / account-recovery.integration.spec.ts.
class CapturingMailSender implements MailSender {
  public sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  lastTokenFor(email: string): string {
    const message = [...this.sent].reverse().find((m) => m.to === email);
    if (!message) {
      throw new Error(`Aucun email capturé pour ${email}`);
    }
    const match = /: (\S+)$/.exec(message.body);
    if (!match?.[1]) {
      throw new Error("Jeton introuvable dans le corps de l'email capturé");
    }
    return match[1];
  }
}

// Phase 6 (docs/PROMPT-MAITRE-SAAS.md) : provisioning automatique — une
// seule transaction (docs/adr/0003-...), idempotence par l'unicité de
// l'email, plan comptable SYSCOHADA initialisé.
describe("ProvisioningController — POST /auth/register (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let accountRecovery: AccountRecoveryService;
  let notifications: NotificationsService;
  let authService: AuthService;
  let tokenService: TokenService;
  const mailSender = new CapturingMailSender();

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];
  const createdUserEmails: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_SENDER)
      .useValue(mailSender)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    accountRecovery = app.get(AccountRecoveryService);
    notifications = app.get(NotificationsService);
    authService = app.get(AuthService);
    tokenService = app.get(TokenService);

    // Catalogue complet requis (DEFAULT_ROLE_PERMISSIONS couvre toutes les
    // clés) : seedé une seule fois par global-setup.js (apps/api/test/),
    // avant que Jest ne lance le moindre worker — plus besoin de le
    // réupserter ici (c'était la source d'un P2002 flaky en CI sous
    // parallélisme réel, cf. commentaire de global-setup.js).
  });

  afterAll(async () => {
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.account.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.setting.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.notification.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.userRole.deleteMany({ where: { role: { enterpriseId: { in: createdEnterpriseIds } } } });
    await prisma.rolePermission.deleteMany({ where: { role: { enterpriseId: { in: createdEnterpriseIds } } } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.authToken.deleteMany({ where: { user: { email: { in: createdUserEmails } } } });
    await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  async function createPlan(trialDays = 14) {
    const plan = await prisma.plan.create({
      data: { code: `PLAN_${randomUUID()}`, name: "Plan de test", priceMonthly: 10_000, trialDays },
    });
    createdPlanIds.push(plan.id);
    return plan;
  }

  function registerPayload(overrides: Partial<Record<string, unknown>> = {}) {
    const email = `founder-${randomUUID()}@test.local`;
    createdUserEmails.push(email);
    return {
      firstName: "Awa",
      lastName: "Diop",
      email,
      password: "FoundingPassw0rd!",
      enterpriseName: `Ma Société ${randomUUID()}`,
      country: "SN",
      ...overrides,
    };
  }

  it("provisions a full enterprise in one call: subscription, ADMIN role, SYSCOHADA accounts, settings, tokens", async () => {
    const plan = await createPlan(14);
    const payload = registerPayload({ planId: plan.id });

    const res = await request(app.getHttpServer()).post("/auth/register").send(payload).expect(201);

    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
    createdEnterpriseIds.push(user.enterpriseId!);
    expect(user.status).toBe("ACTIVE");
    expect(user.emailVerifiedAt).toBeNull();

    const enterprise = await prisma.enterprise.findUniqueOrThrow({ where: { id: user.enterpriseId! } });
    expect(enterprise.name).toBe(payload.enterpriseName);
    expect(enterprise.currentSubscriptionId).not.toBeNull();

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: enterprise.currentSubscriptionId! },
    });
    expect(subscription.status).toBe("TRIAL");
    expect(subscription.planId).toBe(plan.id);
    expect(subscription.trialEndDate).not.toBeNull();
    const daysUntilTrialEnd = Math.round(
      (subscription.trialEndDate!.getTime() - subscription.startDate.getTime()) / 86_400_000,
    );
    expect(daysUntilTrialEnd).toBe(14);

    const roles = await prisma.role.findMany({ where: { enterpriseId: enterprise.id } });
    expect(roles.map((r) => r.name).sort()).toEqual([...DEFAULT_ROLE_NAMES].sort());
    expect(roles.every((r) => r.isSystem)).toBe(true);

    const adminRole = roles.find((r) => r.name === "ADMIN")!;
    const adminPermissions = await prisma.rolePermission.findMany({ where: { roleId: adminRole.id } });
    expect(adminPermissions).toHaveLength(DEFAULT_ROLE_PERMISSIONS.ADMIN.length);

    const userRole = await prisma.userRole.findUniqueOrThrow({
      where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    });
    expect(userRole).toBeDefined();

    const accounts = await prisma.account.findMany({ where: { enterpriseId: enterprise.id }, orderBy: { code: "asc" } });
    expect(accounts.map((a) => ({ code: a.code, label: a.label }))).toEqual([...SYSCOHADA_ACCOUNT_CLASSES]);

    const setting = await prisma.setting.findUniqueOrThrow({
      where: { scope_enterpriseId_key: { scope: "ENTERPRISE", enterpriseId: enterprise.id, key: "commercial.defaults" } },
    });
    expect(setting.value).toMatchObject({ currency: "XOF", locale: "fr-SN", timezone: "Africa/Dakar" });

    const verificationTokens = await prisma.authToken.findMany({
      where: { userId: user.id, type: "EMAIL_VERIFICATION" },
    });
    expect(verificationTokens).toHaveLength(1);

    const welcomeNotifications = await prisma.notification.findMany({
      where: { userId: user.id, type: "WELCOME" },
    });
    expect(welcomeNotifications).toHaveLength(1);

    const auditLogs = await prisma.auditLog.findMany({
      where: { enterpriseId: enterprise.id, action: "ENTERPRISE_PROVISIONED" },
    });
    expect(auditLogs).toHaveLength(1);

    const accessToken = res.body.accessToken as string;
    const meRes = await request(app.getHttpServer()).get("/auth/me").set("Authorization", `Bearer ${accessToken}`).expect(200);
    expect(meRes.body.id).toBe(user.id);
  });

  it("is idempotent on email: a replay with the same email is rejected and creates nothing", async () => {
    const plan = await createPlan();
    const payload = registerPayload({ planId: plan.id });

    await request(app.getHttpServer()).post("/auth/register").send(payload).expect(201);
    const firstUser = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
    createdEnterpriseIds.push(firstUser.enterpriseId!);

    // BIL-10 (docs/audit/BILLING-AUDIT.md) : ENTERPRISE_PROVISIONED est
    // désormais écrit dans la même transaction que l'entreprise elle-même —
    // le compte avant la deuxième tentative sert de référence pour prouver
    // qu'un rollback de transaction l'entraîne bien avec lui, pas seulement
    // les lignes métier.
    const auditCountBeforeReplay = await prisma.auditLog.count({ where: { action: "ENTERPRISE_PROVISIONED" } });

    const secondAttemptEnterpriseName = `Duplicate Attempt ${randomUUID()}`;
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ ...payload, enterpriseName: secondAttemptEnterpriseName })
      .expect(409);

    const orphanEnterprise = await prisma.enterprise.findFirst({ where: { name: secondAttemptEnterpriseName } });
    expect(orphanEnterprise).toBeNull();

    const usersWithEmail = await prisma.user.count({ where: { email: payload.email } });
    expect(usersWithEmail).toBe(1);

    const auditCountAfterReplay = await prisma.auditLog.count({ where: { action: "ENTERPRISE_PROVISIONED" } });
    expect(auditCountAfterReplay).toBe(auditCountBeforeReplay);
  });

  it("rejects an unknown planId and leaves no orphaned enterprise", async () => {
    const payload = registerPayload({ planId: randomUUID() });

    await request(app.getHttpServer()).post("/auth/register").send(payload).expect(404);

    const orphanEnterprise = await prisma.enterprise.findFirst({ where: { name: payload.enterpriseName } });
    expect(orphanEnterprise).toBeNull();
    const orphanUser = await prisma.user.findUnique({ where: { email: payload.email } });
    expect(orphanUser).toBeNull();
  });

  it("rejects a duplicate NINEA within the same country and leaves no orphaned rows", async () => {
    const plan = await createPlan();
    const sharedNinea = `NINEA-${randomUUID()}`;

    const first = registerPayload({ planId: plan.id, ninea: sharedNinea, country: "SN" });
    await request(app.getHttpServer()).post("/auth/register").send(first).expect(201);
    const firstUser = await prisma.user.findUniqueOrThrow({ where: { email: first.email } });
    createdEnterpriseIds.push(firstUser.enterpriseId!);

    const second = registerPayload({ planId: plan.id, ninea: sharedNinea, country: "SN" });
    await request(app.getHttpServer()).post("/auth/register").send(second).expect(409);

    const orphanUser = await prisma.user.findUnique({ where: { email: second.email } });
    expect(orphanUser).toBeNull();
    const orphanEnterprise = await prisma.enterprise.findFirst({ where: { name: second.enterpriseName } });
    expect(orphanEnterprise).toBeNull();
  });

  // BIL-10 (docs/audit/BILLING-AUDIT.md) : les effets secondaires
  // post-commit ne doivent jamais transformer une inscription réussie en
  // 500 — l'entreprise, l'utilisateur et l'abonnement existent déjà.
  it("still succeeds with 201 and valid tokens when issuing the email verification token fails (BIL-10)", async () => {
    const plan = await createPlan();
    const payload = registerPayload({ planId: plan.id });

    jest.spyOn(accountRecovery, "issueEmailVerificationToken").mockImplementationOnce(async () => {
      throw new Error("simulated failure — verification token issuance");
    });

    const res = await request(app.getHttpServer()).post("/auth/register").send(payload).expect(201);
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
    createdEnterpriseIds.push(user.enterpriseId!);

    const auditLogs = await prisma.auditLog.findMany({
      where: { enterpriseId: user.enterpriseId!, action: "ENTERPRISE_PROVISIONED" },
    });
    expect(auditLogs).toHaveLength(1);

    const verificationTokens = await prisma.authToken.findMany({
      where: { userId: user.id, type: "EMAIL_VERIFICATION" },
    });
    expect(verificationTokens).toHaveLength(0);

    const welcomeNotifications = await prisma.notification.findMany({ where: { userId: user.id, type: "WELCOME" } });
    expect(welcomeNotifications).toHaveLength(0);
  });

  it("still succeeds with 201 and valid tokens when sending the welcome notification fails (BIL-10)", async () => {
    const plan = await createPlan();
    const payload = registerPayload({ planId: plan.id });

    jest.spyOn(notifications, "notify").mockImplementationOnce(async () => {
      throw new Error("simulated failure — notification delivery");
    });

    const res = await request(app.getHttpServer()).post("/auth/register").send(payload).expect(201);
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
    createdEnterpriseIds.push(user.enterpriseId!);

    const auditLogs = await prisma.auditLog.findMany({
      where: { enterpriseId: user.enterpriseId!, action: "ENTERPRISE_PROVISIONED" },
    });
    expect(auditLogs).toHaveLength(1);

    // Le jeton a bien été émis, avant que l'envoi de la notification qui
    // devait le porter n'échoue.
    const verificationTokens = await prisma.authToken.findMany({
      where: { userId: user.id, type: "EMAIL_VERIFICATION" },
    });
    expect(verificationTokens).toHaveLength(1);

    const welcomeNotifications = await prisma.notification.findMany({ where: { userId: user.id, type: "WELCOME" } });
    expect(welcomeNotifications).toHaveLength(0);
  });

  // BIL-10 : issueTokenPair reste volontairement bloquant (fait partie du
  // contrat de réponse) — vérifie que le filet de secours documenté dans
  // l'ADR 0003 fonctionne réellement : le compte créé reste utilisable via
  // /auth/login, indépendamment de cet échec résiduel.
  it("leaves the account fully usable via /auth/login even when the final token-pair issuance fails (residual behavior)", async () => {
    const plan = await createPlan();
    const payload = registerPayload({ planId: plan.id });

    jest.spyOn(authService, "issueTokenPair").mockImplementationOnce(async () => {
      throw new Error("simulated failure — token pair issuance");
    });

    await request(app.getHttpServer()).post("/auth/register").send(payload).expect(500);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
    createdEnterpriseIds.push(user.enterpriseId!);
    expect(user.status).toBe("ACTIVE");

    const auditLogs = await prisma.auditLog.findMany({
      where: { enterpriseId: user.enterpriseId!, action: "ENTERPRISE_PROVISIONED" },
    });
    expect(auditLogs).toHaveLength(1);

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: payload.email, password: payload.password })
      .expect(200);
    expect(typeof loginRes.body.accessToken).toBe("string");
  });

  // BIL-11 (docs/audit/BILLING-AUDIT.md) : le jeton de vérification d'email
  // ne doit jamais être persisté en clair dans `Notification.body` (lisible
  // par quiconque a un accès en lecture à la base), tout en continuant à
  // atteindre réellement l'utilisateur par email.
  it("never persists the raw email verification token in Notification.body, while still sending it in the email (BIL-11)", async () => {
    const plan = await createPlan();
    const payload = registerPayload({ planId: plan.id });

    await request(app.getHttpServer()).post("/auth/register").send(payload).expect(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } });
    createdEnterpriseIds.push(user.enterpriseId!);

    // Non-régression : le jeton est bien présent dans l'email réellement
    // envoyé, et c'est bien le jeton émis pour cet utilisateur (comparaison
    // avec le hash stocké, pas une simple présence d'une chaîne quelconque).
    const sentToken = mailSender.lastTokenFor(payload.email);
    const verificationToken = await prisma.authToken.findUniqueOrThrow({
      where: { tokenHash: tokenService.hashToken(sentToken) },
    });
    expect(verificationToken.userId).toBe(user.id);
    expect(verificationToken.type).toBe("EMAIL_VERIFICATION");

    // Le coeur de BIL-11 : ce même jeton ne doit apparaître nulle part dans
    // le corps persisté de la notification "WELCOME".
    const welcomeNotification = await prisma.notification.findFirstOrThrow({
      where: { userId: user.id, type: "WELCOME" },
    });
    expect(welcomeNotification.body).not.toContain(sentToken);
  });
});
