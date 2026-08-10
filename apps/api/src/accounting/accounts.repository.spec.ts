import { ConflictException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { AccountsRepository } from "./accounts.repository";
import { JournalRepository } from "./journal.repository";

// Testé directement contre une base réelle (via TenantContext.run), sans
// passer par une route HTTP — même patron que products.repository.spec.ts.
// JournalRepository prépare les fixtures de solde (réutilise le module déjà
// testé plutôt que d'insérer des JournalEntryLine à la main).
describe("AccountsRepository", () => {
  const prisma = new PrismaService();
  const tenantPrisma = new TenantScopedPrismaService();
  const repository = new AccountsRepository(tenantPrisma);
  const journalRepository = new JournalRepository(tenantPrisma);

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.journalEntryLine.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.journalEntry.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.journalEntryCounter.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.account.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  async function createEnterprise() {
    const enterprise = await prisma.enterprise.create({ data: { name: `Accounts Repo Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    return enterprise;
  }

  function asTenant<T>(enterpriseId: string, fn: () => Promise<T>): Promise<T> {
    return TenantContext.run({ tenantId: enterpriseId, userId: randomUUID(), isSuperAdmin: false }, fn);
  }

  function createAccount(enterpriseId: string, code: string, label = "Compte test") {
    return asTenant(enterpriseId, () => repository.create(enterpriseId, { code, label }));
  }

  it("creates an account with zero balance", async () => {
    const enterprise = await createEnterprise();
    const account = await createAccount(enterprise.id, "601000", "Achats de marchandises");

    expect(account.code).toBe("601000");
    expect(account.totalDebit).toBe(0);
    expect(account.totalCredit).toBe(0);
    expect(account.balance).toBe(0);
  });

  it("rejects creating an account with a duplicate code in the same tenant", async () => {
    const enterprise = await createEnterprise();
    await createAccount(enterprise.id, "701000");

    await expect(createAccount(enterprise.id, "701000")).rejects.toThrow(ConflictException);
  });

  it("allows the same code in two different tenants", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    await expect(createAccount(enterpriseA.id, "601000")).resolves.toBeDefined();
    await expect(createAccount(enterpriseB.id, "601000")).resolves.toBeDefined();
  });

  it("updates only the label, code stays immutable", async () => {
    const enterprise = await createEnterprise();
    const account = await createAccount(enterprise.id, "601000", "Ancien libellé");

    const updated = await asTenant(enterprise.id, () =>
      repository.update(enterprise.id, account.id, { label: "Nouveau libellé" }),
    );

    expect(updated.code).toBe("601000");
    expect(updated.label).toBe("Nouveau libellé");
  });

  it("computes the account balance from posted journal entry lines (debit - credit)", async () => {
    const enterprise = await createEnterprise();
    const bank = await createAccount(enterprise.id, "521000", "Banque");
    const capital = await createAccount(enterprise.id, "101000", "Capital");

    await asTenant(enterprise.id, () =>
      journalRepository.create(enterprise.id, {
        description: "Apport en capital",
        lines: [
          { accountId: bank.id, debitAmount: 500_000, creditAmount: 0 },
          { accountId: capital.id, debitAmount: 0, creditAmount: 500_000 },
        ],
      }),
    );

    const bankView = await asTenant(enterprise.id, () => repository.findByIdOrThrow(enterprise.id, bank.id));
    expect(bankView.totalDebit).toBe(500_000);
    expect(bankView.totalCredit).toBe(0);
    expect(bankView.balance).toBe(500_000);

    const capitalView = await asTenant(enterprise.id, () => repository.findByIdOrThrow(enterprise.id, capital.id));
    expect(capitalView.totalDebit).toBe(0);
    expect(capitalView.totalCredit).toBe(500_000);
    expect(capitalView.balance).toBe(-500_000);
  });

  it("computes a balanced trial balance across all accounts", async () => {
    const enterprise = await createEnterprise();
    const bank = await createAccount(enterprise.id, "521000", "Banque");
    const capital = await createAccount(enterprise.id, "101000", "Capital");

    await asTenant(enterprise.id, () =>
      journalRepository.create(enterprise.id, {
        description: "Apport en capital",
        lines: [
          { accountId: bank.id, debitAmount: 200_000, creditAmount: 0 },
          { accountId: capital.id, debitAmount: 0, creditAmount: 200_000 },
        ],
      }),
    );

    const trialBalance = await asTenant(enterprise.id, () => repository.trialBalance(enterprise.id));
    expect(trialBalance.totalDebit).toBe(200_000);
    expect(trialBalance.totalCredit).toBe(200_000);
    expect(trialBalance.accounts.map((a) => a.code)).toEqual(["101000", "521000"]);
  });

  it("throws NotFoundException when reading an account that belongs to another enterprise", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const accountB = await createAccount(enterpriseB.id, "601000");

    await expect(
      asTenant(enterpriseA.id, () => repository.findByIdOrThrow(enterpriseA.id, accountB.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
