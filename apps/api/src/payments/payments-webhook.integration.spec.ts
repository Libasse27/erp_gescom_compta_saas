import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID, createHmac, createHash } from "node:crypto";
import { authenticator } from "otplib";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { MfaService } from "../auth/mfa.service";

// Phase 5 (docs/PROMPT-MAITRE-SAAS.md) : webhook de paiement — idempotence,
// signature, transitions PAST_DUE/ACTIVE, génération de facture. Adapté à ce
// projet : un webhook ne crée jamais un Subscription (il n'existe qu'après
// provisioning, Phase 6) — l'équivalent testé ici est "rejoué 3x => un seul
// changement de statut / une seule facture", pas "un seul abonnement créé".
describe("PaymentsWebhookController (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;
  let mfaService: MfaService;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];
  const createdUserIds: string[] = [];

  const wave = { provider: "WAVE" as const, secret: process.env.PAYMENT_WEBHOOK_SECRET_WAVE! };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
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
    await prisma.invoice.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.invoiceCounter.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.payment.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.subscriptionEvent.deleteMany({
      where: { subscription: { enterpriseId: { in: createdEnterpriseIds } } },
    });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.user.deleteMany({
      where: { OR: [{ enterpriseId: { in: createdEnterpriseIds } }, { id: { in: createdUserIds } }] },
    });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  function sign(secret: string, timestamp: string, body: Buffer): string {
    return createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${timestamp}.`, "utf8"), body])).digest("hex");
  }

  function nowSeconds(offsetSeconds = 0): string {
    return String(Math.floor(Date.now() / 1000) + offsetSeconds);
  }

  // BIL-09 (docs/audit/BILLING-AUDIT.md) : l'empreinte du corps brut est la
  // seule donnée stable qui corrèle une requête de test à l'entrée d'audit
  // qu'elle a produite — pour un rejet de signature, ni enterpriseId ni
  // providerReference ne sont encore connus du service au moment de l'audit.
  function expectedBodyHash(payload: object | string): string {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    return createHash("sha256").update(body).digest("hex");
  }

  async function findRejectionAudit(bodyHash: string) {
    const rejections = await prisma.auditLog.findMany({ where: { action: "PAYMENT_WEBHOOK_REJECTED" } });
    return rejections.find((log) => (log.metadata as Record<string, unknown> | null)?.bodyHash === bodyHash);
  }

  function postWebhook(
    provider: string,
    payload: object,
    secret: string,
    options: { signatureOverride?: string; timestampOverride?: string | null } = {},
  ) {
    // superagent JSON.stringify tout ce qui n'est pas une string dès que le
    // Content-Type est application/json (y compris un Buffer — vérifié
    // empiriquement) : on envoie donc la chaîne JSON déjà sérialisée, jamais
    // un Buffer, pour que les octets reçus par le serveur (req.rawBody)
    // soient exactement ceux sur lesquels la signature est calculée.
    const rawBodyString = JSON.stringify(payload);
    const rawBody = Buffer.from(rawBodyString, "utf8");
    // timestampOverride === null : n'envoie aucun en-tête timestamp (BIL-06).
    const timestamp = options.timestampOverride === undefined ? nowSeconds() : options.timestampOverride;
    const signature = options.signatureOverride ?? sign(secret, timestamp ?? nowSeconds(), rawBody);
    const req = request(app.getHttpServer())
      .post(`/webhooks/payments/${provider}`)
      .set("Content-Type", "application/json");
    if (signature !== "__no_signature__") {
      req.set("x-webhook-signature", signature);
    }
    if (timestamp !== null) {
      req.set("x-webhook-timestamp", timestamp);
    }
    return req.send(rawBodyString);
  }

  async function createEnterpriseWithActiveUser(subscriptionStatus: "TRIAL" | "ACTIVE") {
    const enterprise = await prisma.enterprise.create({ data: { name: `Webhook Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const plan = await prisma.plan.create({
      data: { code: `PLAN_${randomUUID()}`, name: "Plan de test", priceMonthly: 5_000 },
    });
    createdPlanIds.push(plan.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: subscriptionStatus, startDate: new Date() },
    });
    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { currentSubscriptionId: subscription.id } });

    const user = await prisma.user.create({
      data: {
        email: `user-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash("Whatever9!"),
        firstName: "User",
        lastName: "Test",
        enterpriseId: enterprise.id,
        status: "ACTIVE",
      },
    });

    return { enterprise, subscription, user };
  }

  async function createPendingPayment(enterpriseId: string, subscriptionId: string, amount = 5_000) {
    const providerReference = `ref-${randomUUID()}`;
    const payment = await prisma.payment.create({
      data: {
        enterpriseId,
        subscriptionId,
        provider: "WAVE",
        providerReference,
        amount,
        currency: "XOF",
        status: "PENDING",
      },
    });
    return { paymentId: payment.id, providerReference };
  }

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

  it("confirms a pending payment end-to-end: bootstrap by the Super Admin, then a signed webhook", async () => {
    const superAdminToken = await createSuperAdminToken();
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("TRIAL");

    const bootstrapRes = await request(app.getHttpServer())
      .post(`/admin/enterprises/${enterprise.id}/payments`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ provider: "WAVE", providerReference: `ref-${randomUUID()}`, billingPeriod: "MONTHLY" })
      .expect(201);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: bootstrapRes.body.paymentId } });
    expect(payment.status).toBe("PENDING");

    await postWebhook(
      "WAVE",
      { reference: payment.providerReference, status: "succeeded", amount: 5_000, currency: "XOF" },
      wave.secret,
    ).expect(200);

    const updatedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updatedPayment.status).toBe("SUCCEEDED");
    expect(updatedPayment.paidAt).not.toBeNull();

    const updatedSubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updatedSubscription.status).toBe("ACTIVE");

    const invoices = await prisma.invoice.findMany({ where: { enterpriseId: enterprise.id } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.amount).toBe(5_000);
    expect(invoices[0]!.status).toBe("PAID");

    const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.fromStatus).toBe("TRIAL");
    expect(events[0]!.toStatus).toBe("ACTIVE");

    // BIL-09 (docs/audit/BILLING-AUDIT.md) : un succès n'est jamais un rejet.
    const rejections = await prisma.auditLog.findMany({
      where: { enterpriseId: enterprise.id, action: "PAYMENT_WEBHOOK_REJECTED" },
    });
    expect(rejections).toHaveLength(0);
  });

  it("is idempotent: the same webhook replayed 3 times only changes state and generates an invoice once", async () => {
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("TRIAL");
    const { providerReference } = await createPendingPayment(enterprise.id, subscription.id);
    const payload = { reference: providerReference, status: "succeeded", amount: 5_000, currency: "XOF" };

    const first = await postWebhook("WAVE", payload, wave.secret).expect(200);
    expect(first.body.outcome).toBe("processed");

    const second = await postWebhook("WAVE", payload, wave.secret).expect(200);
    expect(second.body.outcome).toBe("ignored_already_processed");

    const third = await postWebhook("WAVE", payload, wave.secret).expect(200);
    expect(third.body.outcome).toBe("ignored_already_processed");

    const invoices = await prisma.invoice.findMany({ where: { enterpriseId: enterprise.id } });
    expect(invoices).toHaveLength(1);

    const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id } });
    expect(events).toHaveLength(1);
  });

  it("is idempotent under real concurrency: N simultaneous deliveries of the same event produce exactly one invoice (BIL-01)", async () => {
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("TRIAL");
    const { providerReference } = await createPendingPayment(enterprise.id, subscription.id);
    const payload = { reference: providerReference, status: "succeeded", amount: 5_000, currency: "XOF" };

    // Contrairement au test séquentiel ci-dessus, ceci reproduit le scénario
    // réel visé par BIL-01 : plusieurs livraisons du même événement arrivent
    // en même temps (rejeu en rafale d'un fournisseur Mobile Money sur
    // timeout), pas l'une après l'autre. Avant le correctif, la lecture du
    // statut du paiement hors transaction laissait passer plusieurs requêtes
    // concurrentes, chacune générant sa propre facture.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => postWebhook("WAVE", payload, wave.secret).expect(200)),
    );

    const processedCount = results.filter((r) => r.body.outcome === "processed").length;
    const ignoredCount = results.filter((r) => r.body.outcome === "ignored_already_processed").length;
    expect(processedCount).toBe(1);
    expect(ignoredCount).toBe(4);

    const updatedPayment = await prisma.payment.findUniqueOrThrow({
      where: { provider_providerReference: { provider: "WAVE", providerReference } },
    });
    expect(updatedPayment.status).toBe("SUCCEEDED");

    const invoices = await prisma.invoice.findMany({ where: { enterpriseId: enterprise.id } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.paymentId).toBe(updatedPayment.id);

    const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id } });
    expect(events).toHaveLength(1);
  });

  it("rejects a webhook with no signature header, without changing any state", async () => {
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("TRIAL");
    const { paymentId, providerReference } = await createPendingPayment(enterprise.id, subscription.id);
    const payload = { reference: providerReference, status: "succeeded", amount: 5_000, currency: "XOF" };

    await postWebhook("WAVE", payload, wave.secret, { signatureOverride: "__no_signature__" }).expect(401);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("PENDING");

    const rejection = await findRejectionAudit(expectedBodyHash(payload));
    expect(rejection).toBeDefined();
    expect(rejection!.metadata).toMatchObject({ httpStatus: 401, reason: "invalid_signature_or_timestamp" });
  });

  it("rejects a webhook signed with the wrong secret", async () => {
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("TRIAL");
    const { paymentId, providerReference } = await createPendingPayment(enterprise.id, subscription.id);
    const payload = { reference: providerReference, status: "succeeded", amount: 5_000, currency: "XOF" };

    await postWebhook("WAVE", payload, "totally-wrong-secret").expect(401);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("PENDING");

    const rejection = await findRejectionAudit(expectedBodyHash(payload));
    expect(rejection).toBeDefined();
    expect(rejection!.metadata).toMatchObject({ httpStatus: 401, reason: "invalid_signature_or_timestamp" });
  });

  // BIL-06 (docs/audit/BILLING-AUDIT.md) : un corps signé capté une fois ne
  // doit pas rester rejouable indéfiniment.
  it("rejects a webhook with no timestamp header, without changing any state", async () => {
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("TRIAL");
    const { paymentId, providerReference } = await createPendingPayment(enterprise.id, subscription.id);
    const payload = { reference: providerReference, status: "succeeded", amount: 5_000, currency: "XOF" };

    await postWebhook("WAVE", payload, wave.secret, { timestampOverride: null }).expect(401);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("PENDING");

    const rejection = await findRejectionAudit(expectedBodyHash(payload));
    expect(rejection).toBeDefined();
    expect(rejection!.metadata).toMatchObject({ httpStatus: 401, reason: "invalid_signature_or_timestamp" });
  });

  it("rejects a webhook whose timestamp is older than the replay tolerance, without changing any state", async () => {
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("TRIAL");
    const { paymentId, providerReference } = await createPendingPayment(enterprise.id, subscription.id);
    const payload = { reference: providerReference, status: "succeeded", amount: 5_000, currency: "XOF" };
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3_600);

    await postWebhook("WAVE", payload, wave.secret, { timestampOverride: staleTimestamp }).expect(401);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("PENDING");

    const rejection = await findRejectionAudit(expectedBodyHash(payload));
    expect(rejection).toBeDefined();
    expect(rejection!.metadata).toMatchObject({ httpStatus: 401, reason: "invalid_signature_or_timestamp" });
  });

  it("rejects a webhook referencing a payment that was never bootstrapped", async () => {
    const payload = { reference: `unknown-${randomUUID()}`, status: "succeeded", amount: 5_000, currency: "XOF" };

    await postWebhook("WAVE", payload, wave.secret).expect(404);

    const rejection = await findRejectionAudit(expectedBodyHash(payload));
    expect(rejection).toBeDefined();
    expect(rejection!.metadata).toMatchObject({
      httpStatus: 404,
      reason: "unknown_payment_reference",
      providerReference: payload.reference,
    });
  });

  it("rejects a webhook whose amount does not match the pending payment", async () => {
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("TRIAL");
    const { paymentId, providerReference } = await createPendingPayment(enterprise.id, subscription.id, 5_000);
    const payload = { reference: providerReference, status: "succeeded", amount: 999_999, currency: "XOF" };

    await postWebhook("WAVE", payload, wave.secret).expect(400);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("PENDING");

    const rejections = await prisma.auditLog.findMany({
      where: { enterpriseId: enterprise.id, resourceId: paymentId, action: "PAYMENT_WEBHOOK_REJECTED" },
    });
    expect(rejections).toHaveLength(1);
    expect(rejections[0]!.metadata).toMatchObject({ httpStatus: 400, reason: "amount_or_currency_mismatch" });
  });

  // BIL-09 (docs/audit/BILLING-AUDIT.md) : ce chemin (schéma d'événement
  // invalide, mais JSON syntaxiquement valide — une syntaxe JSON invalide
  // est rejetée en amont par le body-parser Express lui-même, avant même
  // d'atteindre ce contrôleur) n'avait jamais de test dédié.
  it("rejects a webhook whose body is valid JSON but does not match the expected event schema, and audits the rejection", async () => {
    const rawBodyString = JSON.stringify({ unexpected: "shape" });
    const rawBody = Buffer.from(rawBodyString, "utf8");
    const timestamp = nowSeconds();
    const signature = sign(wave.secret, timestamp, rawBody);

    await request(app.getHttpServer())
      .post("/webhooks/payments/WAVE")
      .set("Content-Type", "application/json")
      .set("x-webhook-signature", signature)
      .set("x-webhook-timestamp", timestamp)
      .send(rawBodyString)
      .expect(400);

    const rejection = await findRejectionAudit(expectedBodyHash(rawBodyString));
    expect(rejection).toBeDefined();
    expect(rejection!.metadata).toMatchObject({ httpStatus: 400, reason: "malformed_body" });
  });

  // BIL-09 : chemin défensif (createPendingPayment côté plateforme fixe
  // toujours subscriptionId — ce cas n'avait jamais de test dédié).
  it("rejects a webhook for a payment without a subscription, and audits the rejection", async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: `No Subscription Payment ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    const providerReference = `ref-${randomUUID()}`;
    const payment = await prisma.payment.create({
      data: {
        enterpriseId: enterprise.id,
        provider: "WAVE",
        providerReference,
        amount: 5_000,
        currency: "XOF",
        status: "PENDING",
      },
    });

    const payload = { reference: providerReference, status: "succeeded", amount: 5_000, currency: "XOF" };
    await postWebhook("WAVE", payload, wave.secret).expect(409);

    const updatedPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updatedPayment.status).toBe("PENDING");

    const rejections = await prisma.auditLog.findMany({
      where: { enterpriseId: enterprise.id, resourceId: payment.id, action: "PAYMENT_WEBHOOK_REJECTED" },
    });
    expect(rejections).toHaveLength(1);
    expect(rejections[0]!.metadata).toMatchObject({ httpStatus: 409, reason: "payment_without_subscription" });
  });

  it("on failure: moves an ACTIVE subscription to PAST_DUE, sets a grace-period renewal date, and notifies", async () => {
    const { enterprise, subscription, user } = await createEnterpriseWithActiveUser("ACTIVE");
    const { providerReference } = await createPendingPayment(enterprise.id, subscription.id);

    await postWebhook(
      "WAVE",
      { reference: providerReference, status: "failed", amount: 5_000, currency: "XOF" },
      wave.secret,
    ).expect(200);

    const updatedSubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updatedSubscription.status).toBe("PAST_DUE");
    expect(updatedSubscription.renewalDate).not.toBeNull();
    expect(updatedSubscription.renewalDate!.getTime()).toBeGreaterThan(Date.now());

    const notifications = await prisma.notification.findMany({ where: { userId: user.id, type: "PAYMENT_FAILED" } });
    expect(notifications).toHaveLength(1);

    const invoices = await prisma.invoice.findMany({ where: { enterpriseId: enterprise.id } });
    expect(invoices).toHaveLength(0);
  });

  // BIL-08 (docs/audit/BILLING-AUDIT.md) : un échec pendant l'essai n'a
  // aucune conséquence sur le statut — TRIAL → PAST_DUE n'est de toute façon
  // pas une transition autorisée par la machine à états.
  it("on failure during TRIAL: leaves the subscription untouched, marks the payment FAILED, and still notifies (BIL-08)", async () => {
    const { enterprise, subscription, user } = await createEnterpriseWithActiveUser("TRIAL");
    const { paymentId, providerReference } = await createPendingPayment(enterprise.id, subscription.id);

    const res = await postWebhook(
      "WAVE",
      { reference: providerReference, status: "failed", amount: 5_000, currency: "XOF" },
      wave.secret,
    ).expect(200);
    expect(res.body.outcome).toBe("processed");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("FAILED");

    const updatedSubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updatedSubscription.status).toBe("TRIAL");
    expect(updatedSubscription.renewalDate).toBeNull();

    const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id } });
    expect(events).toHaveLength(0);

    const notifications = await prisma.notification.findMany({ where: { userId: user.id, type: "PAYMENT_FAILED" } });
    expect(notifications).toHaveLength(1);

    const invoices = await prisma.invoice.findMany({ where: { enterpriseId: enterprise.id } });
    expect(invoices).toHaveLength(0);
  });

  it("a SUCCEEDED event arriving after a TRIAL failure already recorded is flagged as a conflict, not processed normally (BIL-07/BIL-08 interaction)", async () => {
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("TRIAL");
    const { paymentId, providerReference } = await createPendingPayment(enterprise.id, subscription.id);

    await postWebhook(
      "WAVE",
      { reference: providerReference, status: "failed", amount: 5_000, currency: "XOF" },
      wave.secret,
    ).expect(200);

    const conflictRes = await postWebhook(
      "WAVE",
      { reference: providerReference, status: "succeeded", amount: 5_000, currency: "XOF" },
      wave.secret,
    ).expect(200);
    expect(conflictRes.body.outcome).toBe("status_conflict");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("FAILED");

    const updatedSubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updatedSubscription.status).toBe("TRIAL");

    const invoices = await prisma.invoice.findMany({ where: { enterpriseId: enterprise.id } });
    expect(invoices).toHaveLength(0);
  });

  // BIL-07 (docs/audit/BILLING-AUDIT.md) : un événement différent d'un
  // paiement déjà résolu n'est jamais un simple rejeu — il doit être
  // détectable, jamais avalé silencieusement.
  it("flags as a conflict a SUCCEEDED event arriving after a FAILED already recorded, without activating the subscription", async () => {
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("ACTIVE");
    const { paymentId, providerReference } = await createPendingPayment(enterprise.id, subscription.id);

    await postWebhook(
      "WAVE",
      { reference: providerReference, status: "failed", amount: 5_000, currency: "XOF" },
      wave.secret,
    ).expect(200);

    const conflictRes = await postWebhook(
      "WAVE",
      { reference: providerReference, status: "succeeded", amount: 5_000, currency: "XOF" },
      wave.secret,
    ).expect(200);
    expect(conflictRes.body.outcome).toBe("status_conflict");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("FAILED");
    expect(payment.metadata).toMatchObject({
      conflictingEvent: { status: "SUCCEEDED", detectedAgainstStatus: "FAILED" },
    });

    const updatedSubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updatedSubscription.status).toBe("PAST_DUE");

    const invoices = await prisma.invoice.findMany({ where: { enterpriseId: enterprise.id } });
    expect(invoices).toHaveLength(0);

    const logs = await prisma.auditLog.findMany({ where: { enterpriseId: enterprise.id, resourceId: paymentId } });
    const anomalyLogs = logs.filter((log) => (log.metadata as Record<string, unknown> | null)?.anomaly === true);
    expect(anomalyLogs).toHaveLength(1);
    expect(anomalyLogs[0]!.metadata).toMatchObject({
      anomaly: true,
      severity: "high",
      previousStatus: "FAILED",
      incomingStatus: "SUCCEEDED",
    });

    // BIL-09 : un status_conflict (BIL-07) n'est pas un rejet HTTP — il
    // répond 200 et n'est jamais journalisé comme PAYMENT_WEBHOOK_REJECTED.
    const rejections = await prisma.auditLog.findMany({
      where: { enterpriseId: enterprise.id, action: "PAYMENT_WEBHOOK_REJECTED" },
    });
    expect(rejections).toHaveLength(0);
  });

  it("flags as a conflict a FAILED event arriving after a SUCCEEDED already recorded, without reverting the subscription", async () => {
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("TRIAL");
    const { paymentId, providerReference } = await createPendingPayment(enterprise.id, subscription.id);

    await postWebhook(
      "WAVE",
      { reference: providerReference, status: "succeeded", amount: 5_000, currency: "XOF" },
      wave.secret,
    ).expect(200);

    const conflictRes = await postWebhook(
      "WAVE",
      { reference: providerReference, status: "failed", amount: 5_000, currency: "XOF" },
      wave.secret,
    ).expect(200);
    expect(conflictRes.body.outcome).toBe("status_conflict");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("SUCCEEDED");

    const updatedSubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updatedSubscription.status).toBe("ACTIVE");

    const invoices = await prisma.invoice.findMany({ where: { enterpriseId: enterprise.id } });
    expect(invoices).toHaveLength(1);

    const logs = await prisma.auditLog.findMany({ where: { enterpriseId: enterprise.id, resourceId: paymentId } });
    const anomalyLogs = logs.filter((log) => (log.metadata as Record<string, unknown> | null)?.anomaly === true);
    expect(anomalyLogs).toHaveLength(1);
  });

  it("does not flag a legitimate replay of the same status as a conflict (no anomaly audit entry)", async () => {
    const { enterprise, subscription } = await createEnterpriseWithActiveUser("TRIAL");
    const { paymentId, providerReference } = await createPendingPayment(enterprise.id, subscription.id);
    const payload = { reference: providerReference, status: "succeeded", amount: 5_000, currency: "XOF" };

    await postWebhook("WAVE", payload, wave.secret).expect(200);
    const replayRes = await postWebhook("WAVE", payload, wave.secret).expect(200);
    expect(replayRes.body.outcome).toBe("ignored_already_processed");

    const logs = await prisma.auditLog.findMany({ where: { enterpriseId: enterprise.id, resourceId: paymentId } });
    const anomalyLogs = logs.filter((log) => (log.metadata as Record<string, unknown> | null)?.anomaly === true);
    expect(anomalyLogs).toHaveLength(0);
  });

  it("rejects the bootstrap endpoint for a non-Super-Admin", async () => {
    const { enterprise, subscription, user } = await createEnterpriseWithActiveUser("TRIAL");
    void subscription;

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: "Whatever9!" })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/admin/enterprises/${enterprise.id}/payments`)
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .send({ provider: "WAVE", providerReference: `ref-${randomUUID()}`, billingPeriod: "MONTHLY" })
      .expect(403);
  });

  it("returns 404 from the bootstrap endpoint for an enterprise with no active subscription", async () => {
    const superAdminToken = await createSuperAdminToken();
    const enterprise = await prisma.enterprise.create({ data: { name: `No Sub ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    await request(app.getHttpServer())
      .post(`/admin/enterprises/${enterprise.id}/payments`)
      .set("Authorization", `Bearer ${superAdminToken}`)
      .send({ provider: "WAVE", providerReference: `ref-${randomUUID()}`, billingPeriod: "MONTHLY" })
      .expect(404);
  });
});
