import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { CrossTenantRepository } from "../tenant/cross-tenant.repository";
import { PaymentLifecycleService } from "./payment-lifecycle.service";

// Corrige BIL-19 (docs/audit/BILLING-AUDIT.md) : jusqu'ici, un Payment PENDING
// amorcé (checkout) n'expirait jamais — une référence de plusieurs mois
// restait activable par un webhook signé. Même patron que
// SubscriptionLifecycleService (BIL-03) : purge proactive horaire,
// compare-and-swap, jamais d'écrasement d'un état plus frais.
describe("PaymentLifecycleService (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let service: PaymentLifecycleService;
  let crossTenant: CrossTenantRepository;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    service = app.get(PaymentLifecycleService);
    crossTenant = app.get(CrossTenantRepository);
  });

  afterAll(async () => {
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.payment.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  async function createEnterpriseWithSubscription() {
    const plan = await prisma.plan.create({
      data: { code: `PLAN_${randomUUID()}`, name: "Plan de test", priceMonthly: 5_000 },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `Payment Lifecycle Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: "TRIAL", startDate: new Date() },
    });

    return { enterprise, plan, subscription };
  }

  async function createPayment(
    enterpriseId: string,
    subscriptionId: string,
    status: "PENDING" | "SUCCEEDED" | "FAILED" | "EXPIRED",
    expiresAt: Date | null,
    amount = 5_000,
  ) {
    return prisma.payment.create({
      data: {
        enterpriseId,
        subscriptionId,
        provider: "WAVE",
        providerReference: `ref-${randomUUID()}`,
        amount,
        currency: "XOF",
        status,
        expiresAt,
        paidAt: status === "SUCCEEDED" ? new Date() : null,
      },
    });
  }

  const past = new Date(Date.now() - 3_600_000);
  const future = new Date(Date.now() + 24 * 3_600_000);

  describe("expirePendingPayments", () => {
    it("expires a PENDING payment whose expiresAt is in the past", async () => {
      const { enterprise, subscription } = await createEnterpriseWithSubscription();
      const payment = await createPayment(enterprise.id, subscription.id, "PENDING", past);

      const count = await service.expirePendingPayments();
      expect(count).toBeGreaterThanOrEqual(1);

      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe("EXPIRED");

      const auditLogs = await prisma.auditLog.findMany({
        where: { enterpriseId: enterprise.id, action: "EXPIRE_PAYMENT", resourceId: payment.id },
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0]!.metadata).toMatchObject({ reason: "pending_payment_expired" });
    });

    it("does not touch a PENDING payment whose expiresAt is in the future", async () => {
      const { enterprise, subscription } = await createEnterpriseWithSubscription();
      const payment = await createPayment(enterprise.id, subscription.id, "PENDING", future);

      await service.expirePendingPayments();

      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe("PENDING");
    });

    // Point A de l'arbitrage BIL-19 : pas de backfill — un paiement
    // historique sans expiresAt (NULL) ne doit jamais être expiré
    // rétroactivement.
    it("does not touch a PENDING payment with no expiresAt set (historical, no backfill)", async () => {
      const { enterprise, subscription } = await createEnterpriseWithSubscription();
      const payment = await createPayment(enterprise.id, subscription.id, "PENDING", null);

      await service.expirePendingPayments();

      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe("PENDING");
    });

    it.each(["SUCCEEDED", "FAILED", "EXPIRED"] as const)(
      "never touches an already-%s payment regardless of expiresAt (no-op)",
      async (status) => {
        const { enterprise, subscription } = await createEnterpriseWithSubscription();
        const payment = await createPayment(enterprise.id, subscription.id, status, past);

        await service.expirePendingPayments();

        const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
        expect(updated.status).toBe(status);

        const auditLogs = await prisma.auditLog.findMany({
          where: { enterpriseId: enterprise.id, action: "EXPIRE_PAYMENT", resourceId: payment.id },
        });
        expect(auditLogs).toHaveLength(0);
      },
    );

    it("is idempotent: running it twice in a row never creates a second AuditLog entry", async () => {
      const { enterprise, subscription } = await createEnterpriseWithSubscription();
      const payment = await createPayment(enterprise.id, subscription.id, "PENDING", past);

      await service.expirePendingPayments();
      const secondRunCount = await service.expirePendingPayments();

      expect(secondRunCount).toBe(0);
      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe("EXPIRED");

      const auditLogs = await prisma.auditLog.findMany({
        where: { enterpriseId: enterprise.id, action: "EXPIRE_PAYMENT", resourceId: payment.id },
      });
      expect(auditLogs).toHaveLength(1);
    });

    it("isolates correctly across several payments and enterprises: only the expirable ones are touched", async () => {
      const { enterprise: enterpriseA, subscription: subscriptionA } = await createEnterpriseWithSubscription();
      const { enterprise: enterpriseB, subscription: subscriptionB } = await createEnterpriseWithSubscription();

      const expirableA = await createPayment(enterpriseA.id, subscriptionA.id, "PENDING", past, 5_000);
      const freshA = await createPayment(enterpriseA.id, subscriptionA.id, "PENDING", future, 6_000);
      const expirableB = await createPayment(enterpriseB.id, subscriptionB.id, "PENDING", past, 9_000);
      const settledB = await createPayment(enterpriseB.id, subscriptionB.id, "SUCCEEDED", past, 7_000);

      await service.expirePendingPayments();

      expect((await prisma.payment.findUniqueOrThrow({ where: { id: expirableA.id } })).status).toBe("EXPIRED");
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: freshA.id } })).status).toBe("PENDING");
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: expirableB.id } })).status).toBe("EXPIRED");
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: settledB.id } })).status).toBe("SUCCEEDED");

      const auditLogsA = await prisma.auditLog.findMany({
        where: { enterpriseId: enterpriseA.id, action: "EXPIRE_PAYMENT" },
      });
      expect(auditLogsA.map((l) => l.resourceId)).toEqual([expirableA.id]);

      const auditLogsB = await prisma.auditLog.findMany({
        where: { enterpriseId: enterpriseB.id, action: "EXPIRE_PAYMENT" },
      });
      expect(auditLogsB.map((l) => l.resourceId)).toEqual([expirableB.id]);
    });
  });

  // Exigence explicite de la validation BIL-19 : démontrer le CAS, pas
  // seulement s'appuyer sur le timing aléatoire de Jest.
  describe("compare-and-swap contre une écriture concurrente", () => {
    it("CrossTenantRepository.expirePendingPayment : une seule des deux tentatives sur la même ligne transitionne réellement", async () => {
      const { enterprise, subscription } = await createEnterpriseWithSubscription();
      const payment = await createPayment(enterprise.id, subscription.id, "PENDING", past);

      const [first, second] = await Promise.all([
        crossTenant.expirePendingPayment(payment.id),
        crossTenant.expirePendingPayment(payment.id),
      ]);

      // Concurrence réelle (deux requêtes SQL simultanées sur la même ligne,
      // pas un mock) : exactement une des deux doit gagner la course.
      const counts = [first.count, second.count].sort();
      expect(counts).toEqual([0, 1]);

      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe("EXPIRED");
    });

    it("sequentially calling expirePendingPayment a second time is a pure no-op (count 0, no state corruption)", async () => {
      const { enterprise, subscription } = await createEnterpriseWithSubscription();
      const payment = await createPayment(enterprise.id, subscription.id, "PENDING", past);

      const firstAttempt = await crossTenant.expirePendingPayment(payment.id);
      expect(firstAttempt.count).toBe(1);

      const secondAttempt = await crossTenant.expirePendingPayment(payment.id);
      expect(secondAttempt.count).toBe(0);

      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe("EXPIRED");
    });

    // Reproduit déterministement (pas via le timing de Jest) la fenêtre de
    // course entre la lecture batch du job et son écriture : un webhook de
    // paiement concurrent active le paiement pile entre les deux.
    it("never expires a payment that a concurrent webhook already resolved mid-batch", async () => {
      const { enterprise, subscription } = await createEnterpriseWithSubscription();
      const payment = await createPayment(enterprise.id, subscription.id, "PENDING", past);

      const original = crossTenant.findExpirablePendingPayments.bind(crossTenant);
      jest.spyOn(crossTenant, "findExpirablePendingPayments").mockImplementationOnce(async (now: Date) => {
        const batch = await original(now);
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: "SUCCEEDED", paidAt: new Date() },
        });
        return batch;
      });

      await service.expirePendingPayments();

      const updated = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      expect(updated.status).toBe("SUCCEEDED");

      const auditLogs = await prisma.auditLog.findMany({
        where: { enterpriseId: enterprise.id, action: "EXPIRE_PAYMENT", resourceId: payment.id },
      });
      expect(auditLogs).toHaveLength(0);
    });
  });
});
