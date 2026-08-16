import { randomUUID } from "node:crypto";
import { RawDbClient } from "../prisma/raw-db-client";
import { InvoiceGenerationService } from "./invoice-generation.service";

// Numérotation séquentielle par tenant, sans trou, résistante à la
// concurrence (docs/PROMPT-MAITRE-SAAS.md Phase 3 §"points de vigilance" /
// Phase 5 critère "facture générée avec numérotation séquentielle par tenant").
describe("InvoiceGenerationService", () => {
  const prisma = new RawDbClient();
  const service = new InvoiceGenerationService();

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  afterAll(async () => {
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.invoice.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.invoiceCounter.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.payment.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await prisma.$disconnect();
  });

  async function createEnterpriseWithSubscription(ninea?: string, rccm?: string) {
    const enterprise = await prisma.enterprise.create({
      data: { name: `Invoice Gen Test ${randomUUID()}`, legalName: "Ma Société SARL", ninea, rccm },
    });
    createdEnterpriseIds.push(enterprise.id);

    const plan = await prisma.plan.create({
      data: { code: `PLAN_${randomUUID()}`, name: "Plan de test", priceMonthly: 5_000 },
    });
    createdPlanIds.push(plan.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: "ACTIVE", startDate: new Date() },
    });

    return { enterprise, subscription };
  }

  // generateForPayment() fait payments.connect({id}) : il faut une ligne
  // Payment réelle, comme dans le vrai flux (PaymentWebhookService met à
  // jour le Payment avant de générer la facture).
  async function createPayment(enterpriseId: string, subscriptionId: string, amount: number): Promise<string> {
    const payment = await prisma.payment.create({
      data: {
        enterpriseId,
        subscriptionId,
        provider: "WAVE",
        providerReference: `ref-${randomUUID()}`,
        amount,
        currency: "XOF",
        status: "SUCCEEDED",
        paidAt: new Date(),
      },
    });
    return payment.id;
  }

  it("computes amountExcludingTax + vatAmount = amount at 18% VAT", async () => {
    const { enterprise, subscription } = await createEnterpriseWithSubscription();
    const paymentId = await createPayment(enterprise.id, subscription.id, 11_800);

    const invoice = await prisma.$transaction((tx) =>
      service.generateForPayment(tx, {
        enterprise,
        subscriptionId: subscription.id,
        paymentId,
        amount: 11_800,
        currency: "XOF",
      }),
    );

    expect(invoice.vatRateBasisPoints).toBe(1800);
    expect(invoice.amountExcludingTax + invoice.vatAmount).toBe(invoice.amount);
    expect(invoice.amount).toBe(11_800);
    expect(invoice.amountExcludingTax).toBe(10_000);
    expect(invoice.vatAmount).toBe(1_800);
  });

  it("includes the enterprise's legal identity and the VAT/currency mentions", async () => {
    const { enterprise, subscription } = await createEnterpriseWithSubscription("1234567890123", "SN-DKR-2024-B-1234");
    const paymentId = await createPayment(enterprise.id, subscription.id, 5_000);

    const invoice = await prisma.$transaction((tx) =>
      service.generateForPayment(tx, {
        enterprise,
        subscriptionId: subscription.id,
        paymentId,
        amount: 5_000,
        currency: "XOF",
      }),
    );

    expect(invoice.legalMentions).toContain(enterprise.legalName!);
    expect(invoice.legalMentions).toContain(enterprise.ninea!);
    expect(invoice.legalMentions).toContain(enterprise.rccm!);
    expect(invoice.legalMentions).toContain("TVA 18%");
    expect(invoice.legalMentions).toContain("FCFA");
  });

  it("numbers invoices sequentially per tenant, starting at 1, with no gaps", async () => {
    const { enterprise, subscription } = await createEnterpriseWithSubscription();

    const firstPaymentId = await createPayment(enterprise.id, subscription.id, 5_000);
    const first = await prisma.$transaction((tx) =>
      service.generateForPayment(tx, {
        enterprise,
        subscriptionId: subscription.id,
        paymentId: firstPaymentId,
        amount: 5_000,
        currency: "XOF",
      }),
    );

    const secondPaymentId = await createPayment(enterprise.id, subscription.id, 5_000);
    const second = await prisma.$transaction((tx) =>
      service.generateForPayment(tx, {
        enterprise,
        subscriptionId: subscription.id,
        paymentId: secondPaymentId,
        amount: 5_000,
        currency: "XOF",
      }),
    );

    const prefix = `INV-${enterprise.id.slice(0, 8).toUpperCase()}-`;
    expect(first.number).toBe(`${prefix}000001`);
    expect(second.number).toBe(`${prefix}000002`);
  });

  it("numbers invoices for two different tenants independently, starting each at 1", async () => {
    const tenantA = await createEnterpriseWithSubscription();
    const tenantB = await createEnterpriseWithSubscription();
    const paymentA = await createPayment(tenantA.enterprise.id, tenantA.subscription.id, 5_000);
    const paymentB = await createPayment(tenantB.enterprise.id, tenantB.subscription.id, 5_000);

    const invoiceA = await prisma.$transaction((tx) =>
      service.generateForPayment(tx, {
        enterprise: tenantA.enterprise,
        subscriptionId: tenantA.subscription.id,
        paymentId: paymentA,
        amount: 5_000,
        currency: "XOF",
      }),
    );
    const invoiceB = await prisma.$transaction((tx) =>
      service.generateForPayment(tx, {
        enterprise: tenantB.enterprise,
        subscriptionId: tenantB.subscription.id,
        paymentId: paymentB,
        amount: 5_000,
        currency: "XOF",
      }),
    );

    expect(invoiceA.number.endsWith("-000001")).toBe(true);
    expect(invoiceB.number.endsWith("-000001")).toBe(true);
    expect(invoiceA.number).not.toBe(invoiceB.number);
  });

  it("stays gap-free and unique under concurrent generation for the same tenant", async () => {
    const { enterprise, subscription } = await createEnterpriseWithSubscription();
    const paymentIds = await Promise.all(
      Array.from({ length: 5 }, () => createPayment(enterprise.id, subscription.id, 5_000)),
    );

    const results = await Promise.all(
      paymentIds.map((paymentId) =>
        prisma.$transaction((tx) =>
          service.generateForPayment(tx, {
            enterprise,
            subscriptionId: subscription.id,
            paymentId,
            amount: 5_000,
            currency: "XOF",
          }),
        ),
      ),
    );

    const numbers = results.map((invoice) => invoice.number).sort();
    const prefix = `INV-${enterprise.id.slice(0, 8).toUpperCase()}-`;
    expect(numbers).toEqual([1, 2, 3, 4, 5].map((n) => `${prefix}${String(n).padStart(6, "0")}`));
  });
});
