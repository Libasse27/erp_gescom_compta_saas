import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { CrossTenantRepository } from "../tenant/cross-tenant.repository";
import { SubscriptionLifecycleService } from "./subscription-lifecycle.service";
import {
  createSetupAdmin,
  createTenantFixtureTracking,
  cleanupTenantFixtures,
} from "../../test/tenant-fixtures";

// Corrige BIL-03 (docs/audit/BILLING-AUDIT.md) : jusqu'ici, aucun code ne
// produisait jamais TRIAL->EXPIRED ni PAST_DUE->SUSPENDED — un essai
// gratuit ne se terminait jamais, un impayé ne restreignait jamais rien.
describe("SubscriptionLifecycleService (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let service: SubscriptionLifecycleService;
  let crossTenant: CrossTenantRepository;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];
  const tracking = createTenantFixtureTracking();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    service = app.get(SubscriptionLifecycleService);
    crossTenant = app.get(CrossTenantRepository);
  });

  afterAll(async () => {
    await prisma.subscriptionEvent.deleteMany({
      where: { subscription: { enterpriseId: { in: createdEnterpriseIds } } },
    });
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await cleanupTenantFixtures(prisma, tracking);
    await app.close();
  });

  async function createPlan() {
    const plan = await prisma.plan.create({
      data: { code: `PLAN_${randomUUID()}`, name: "Plan de test", priceMonthly: 5_000 },
    });
    createdPlanIds.push(plan.id);
    return plan;
  }

  async function createSubscription(overrides: {
    status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "EXPIRED" | "CANCELLED";
    trialEndDate?: Date | null;
    renewalDate?: Date | null;
  }) {
    const plan = await createPlan();
    const enterprise = await prisma.enterprise.create({ data: { name: `Lifecycle Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const subscription = await prisma.subscription.create({
      data: {
        enterpriseId: enterprise.id,
        planId: plan.id,
        status: overrides.status,
        startDate: new Date(),
        trialEndDate: overrides.trialEndDate,
        renewalDate: overrides.renewalDate,
      },
    });

    return { enterprise, plan, subscription };
  }

  const past = new Date(Date.now() - 24 * 3_600_000);
  const future = new Date(Date.now() + 24 * 3_600_000);

  describe("expireTrials", () => {
    it("expires a TRIAL subscription whose trialEndDate is in the past", async () => {
      const { subscription, enterprise } = await createSubscription({ status: "TRIAL", trialEndDate: past });

      const count = await service.expireTrials();
      expect(count).toBeGreaterThanOrEqual(1);

      const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(updated.status).toBe("EXPIRED");

      const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id } });
      expect(events).toHaveLength(1);
      expect(events[0]!.fromStatus).toBe("TRIAL");
      expect(events[0]!.toStatus).toBe("EXPIRED");

      const auditLogs = await prisma.auditLog.findMany({
        where: { enterpriseId: enterprise.id, action: "EXPIRE_TRIAL", resourceId: subscription.id },
      });
      expect(auditLogs).toHaveLength(1);
    });

    it("does not touch a TRIAL subscription whose trialEndDate is in the future", async () => {
      const { subscription } = await createSubscription({ status: "TRIAL", trialEndDate: future });

      await service.expireTrials();

      const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(updated.status).toBe("TRIAL");
    });

    it("does not touch a TRIAL subscription with no trialEndDate set", async () => {
      const { subscription } = await createSubscription({ status: "TRIAL", trialEndDate: null });

      await service.expireTrials();

      const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(updated.status).toBe("TRIAL");
    });

    it("is idempotent: running it twice in a row never creates a second SubscriptionEvent", async () => {
      const { subscription } = await createSubscription({ status: "TRIAL", trialEndDate: past });

      await service.expireTrials();
      const secondRunCount = await service.expireTrials();

      expect(secondRunCount).toBe(0);
      const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id } });
      expect(events).toHaveLength(1);
    });
  });

  describe("suspendOverdueGracePeriods", () => {
    it("suspends a PAST_DUE subscription whose renewalDate (échéance de grâce) is in the past", async () => {
      const { subscription, enterprise } = await createSubscription({ status: "PAST_DUE", renewalDate: past });

      const count = await service.suspendOverdueGracePeriods();
      expect(count).toBeGreaterThanOrEqual(1);

      const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(updated.status).toBe("SUSPENDED");

      const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id } });
      expect(events).toHaveLength(1);
      expect(events[0]!.fromStatus).toBe("PAST_DUE");
      expect(events[0]!.toStatus).toBe("SUSPENDED");

      const auditLogs = await prisma.auditLog.findMany({
        where: { enterpriseId: enterprise.id, action: "SUSPEND_SUBSCRIPTION", resourceId: subscription.id },
      });
      expect(auditLogs).toHaveLength(1);
    });

    it("does not touch a PAST_DUE subscription still within its grace period (renewalDate in the future)", async () => {
      const { subscription } = await createSubscription({ status: "PAST_DUE", renewalDate: future });

      await service.suspendOverdueGracePeriods();

      const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(updated.status).toBe("PAST_DUE");
    });
  });

  it("never touches an ACTIVE subscription regardless of trialEndDate/renewalDate", async () => {
    const { subscription } = await createSubscription({ status: "ACTIVE", trialEndDate: past, renewalDate: past });

    await service.expireTrials();
    await service.suspendOverdueGracePeriods();

    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.status).toBe("ACTIVE");
  });

  // Boucle la conséquence d'accès (docs/audit/BILLING-AUDIT.md, solution
  // suggérée : "essai échu ⇒ écriture refusée") : une fois le tenant expiré
  // par le job, SubscriptionAccessGuard doit bloquer une requête mutante,
  // pas seulement l'état de Subscription en base.
  it("blocks a mutating request from a tenant whose trial the job just expired", async () => {
    const setupAdmin = createSetupAdmin(app, prisma, app.get(PasswordService), tracking);
    const tenant = await setupAdmin("Tenant Lifecycle E2E");

    await prisma.subscription.updateMany({
      where: { enterpriseId: tenant.enterpriseId },
      data: { status: "TRIAL", trialEndDate: past },
    });

    await service.expireTrials();

    await request(app.getHttpServer())
      .post("/customers")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ type: "COMPANY", name: "Devrait être refusé" })
      .expect(403);
  });

  // Régression : la revue de BIL-03 a identifié que updateSubscriptionStatus
  // écrivait sans garde compare-and-swap — un webhook de paiement concurrent
  // qui fait passer PAST_DUE -> ACTIVE entre la lecture batch et l'écriture
  // du job pouvait voir son résultat écrasé par SUSPENDED.
  describe("compare-and-swap contre une écriture concurrente", () => {
    it("CrossTenantRepository.updateSubscriptionStatus refuse d'écraser un statut qui a déjà changé", async () => {
      const { subscription } = await createSubscription({ status: "PAST_DUE", renewalDate: past });

      // Simule le webhook de paiement : transition réussie pendant que le
      // job n'a pas encore écrit.
      const firstWrite = await crossTenant.updateSubscriptionStatus(subscription.id, "PAST_DUE", "ACTIVE");
      expect(firstWrite.count).toBe(1);

      // Le job, qui travaille sur son instantané périmé ("PAST_DUE"), ne
      // doit jamais écraser ce statut plus frais.
      const staleWrite = await crossTenant.updateSubscriptionStatus(subscription.id, "PAST_DUE", "SUSPENDED");
      expect(staleWrite.count).toBe(0);

      const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(updated.status).toBe("ACTIVE");
    });

    it("never suspends a subscription that a concurrent payment already reactivated mid-batch", async () => {
      const { subscription, enterprise } = await createSubscription({ status: "PAST_DUE", renewalDate: past });

      // Le job lit son lot (l'abonnement est encore PAST_DUE ici) ; on
      // simule ensuite, juste après cette lecture mais avant l'écriture du
      // job, un paiement concurrent qui réactive l'abonnement — exactement
      // la fenêtre de la race identifiée en revue.
      const original = crossTenant.findOverdueGracePeriodSubscriptions.bind(crossTenant);
      jest.spyOn(crossTenant, "findOverdueGracePeriodSubscriptions").mockImplementationOnce(async (now: Date) => {
        const batch = await original(now);
        await crossTenant.updateSubscriptionStatus(subscription.id, "PAST_DUE", "ACTIVE");
        return batch;
      });

      await service.suspendOverdueGracePeriods();

      const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(updated.status).toBe("ACTIVE");

      const events = await prisma.subscriptionEvent.findMany({ where: { subscriptionId: subscription.id } });
      expect(events).toHaveLength(0);

      const auditLogs = await prisma.auditLog.findMany({
        where: { enterpriseId: enterprise.id, action: "SUSPEND_SUBSCRIPTION", resourceId: subscription.id },
      });
      expect(auditLogs).toHaveLength(0);
    });
  });
});
