import { NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RawDbClient } from "../prisma/raw-db-client";
import { TenantContext } from "../tenant/tenant-context";
import { TenantScopedPrismaService } from "../tenant/tenant-scoped-prisma.service";
import { AccountsRepository } from "./accounts.repository";
import { JournalRepository } from "./journal.repository";

// Testé directement contre une base réelle — même patron que
// accounts.repository.spec.ts. AccountsRepository prépare les comptes
// nécessaires aux lignes d'écriture.
describe("JournalRepository", () => {
  const prisma = new RawDbClient();
  const tenantPrisma = new TenantScopedPrismaService();
  const accountsRepository = new AccountsRepository(tenantPrisma);
  const repository = new JournalRepository(tenantPrisma);

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
    const enterprise = await prisma.enterprise.create({ data: { name: `Journal Repo Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    return enterprise;
  }

  function asTenant<T>(enterpriseId: string, fn: () => Promise<T>): Promise<T> {
    return TenantContext.run({ tenantId: enterpriseId, userId: randomUUID(), isSuperAdmin: false }, fn);
  }

  function createAccount(enterpriseId: string, code: string) {
    return asTenant(enterpriseId, () => accountsRepository.create(enterpriseId, { code, label: "Compte test" }));
  }

  // create() renvoie désormais { view, created } (docs/adr/0019-...) : ce
  // dépouilleur garde la majorité des tests lisibles sans changement
  // supplémentaire.
  async function createEntry(
    enterpriseId: string,
    input: Parameters<JournalRepository["create"]>[1],
    idempotencyKey?: string,
  ) {
    const { view } = await repository.create(enterpriseId, input, idempotencyKey);
    return view;
  }

  it("creates a balanced entry, snapshotting each line's account code/label", async () => {
    const enterprise = await createEnterprise();
    const bank = await createAccount(enterprise.id, "521000");
    const sales = await createAccount(enterprise.id, "701000");

    const entry = await asTenant(enterprise.id, () =>
      createEntry(enterprise.id, {
        description: "Vente au comptant",
        reference: "FACT-0001",
        lines: [
          { accountId: bank.id, label: "Encaissement", debitAmount: 10_000, creditAmount: 0 },
          { accountId: sales.id, label: "Vente", debitAmount: 0, creditAmount: 10_000 },
        ],
      }),
    );

    expect(entry.totalDebit).toBe(10_000);
    expect(entry.totalCredit).toBe(10_000);
    expect(entry.lines).toHaveLength(2);
    expect(entry.lines[0].accountCode).toBe("521000");
    expect(entry.number).toMatch(new RegExp(`^ECR-${enterprise.id.slice(0, 8).toUpperCase()}-\\d{6}$`));
  });

  it("numbers journal entries sequentially per tenant, without gaps", async () => {
    const enterprise = await createEnterprise();
    const bank = await createAccount(enterprise.id, "521000");
    const sales = await createAccount(enterprise.id, "701000");
    const lines = [
      { accountId: bank.id, debitAmount: 1_000, creditAmount: 0 },
      { accountId: sales.id, debitAmount: 0, creditAmount: 1_000 },
    ];

    const first = await asTenant(enterprise.id, () => createEntry(enterprise.id, { description: "A", lines }));
    const second = await asTenant(enterprise.id, () => createEntry(enterprise.id, { description: "B", lines }));

    expect(first.number.endsWith("000001")).toBe(true);
    expect(second.number.endsWith("000002")).toBe(true);
  });

  // Régression ACC-01 (docs/audit/ACCOUNTING-AUDIT.md) : create() est appelé
  // ici directement, sans transiter par createJournalEntrySchema (Zod) —
  // exactement le scénario que l'audit signale comme non protégé (job de
  // reprise, seed, futur module d'auto-comptabilisation appelant le
  // repository sans passer par le contrôleur HTTP).
  it("rejects an unbalanced entry even when called directly, bypassing Zod validation", async () => {
    const enterprise = await createEnterprise();
    const bank = await createAccount(enterprise.id, "521000");
    const sales = await createAccount(enterprise.id, "701000");

    await expect(
      asTenant(enterprise.id, () =>
        repository.create(enterprise.id, {
          description: "Écriture déséquilibrée",
          lines: [
            { accountId: bank.id, debitAmount: 10_000, creditAmount: 0 },
            { accountId: sales.id, debitAmount: 0, creditAmount: 5_000 },
          ],
        }),
      ),
    ).rejects.toThrow("Écriture déséquilibrée");

    const entries = await prisma.journalEntry.findMany({ where: { enterpriseId: enterprise.id } });
    expect(entries).toHaveLength(0);
  });

  it("rejects a line carrying both a debit and a credit, even when the entry totals balance out", async () => {
    const enterprise = await createEnterprise();
    const bank = await createAccount(enterprise.id, "521000");
    const sales = await createAccount(enterprise.id, "701000");

    // Totaux équilibrés (10 000 = 10 000) malgré deux lignes individuellement
    // invalides : seule la vérification ligne par ligne peut détecter ce cas.
    await expect(
      asTenant(enterprise.id, () =>
        repository.create(enterprise.id, {
          description: "Ligne invalide",
          lines: [
            { accountId: bank.id, debitAmount: 5_000, creditAmount: 5_000 },
            { accountId: sales.id, debitAmount: 5_000, creditAmount: 5_000 },
          ],
        }),
      ),
    ).rejects.toThrow("Une ligne doit porter soit un débit, soit un crédit");
  });

  // Dernier filet : même en contournant entièrement l'application (accès
  // direct à la base avec le rôle propriétaire des tests), la contrainte SQL
  // journal_entry_lines_amounts_check refuse une ligne déséquilibrée.
  it("rejects an unbalanced line at the database level (CHECK constraint)", async () => {
    const enterprise = await createEnterprise();
    const bank = await createAccount(enterprise.id, "521000");
    const entry = await prisma.journalEntry.create({
      data: { enterpriseId: enterprise.id, number: `ECR-DIRECT-${randomUUID()}`, description: "Direct" },
    });

    await expect(
      prisma.journalEntryLine.create({
        data: {
          journalEntryId: entry.id,
          enterpriseId: enterprise.id,
          accountId: bank.id,
          debitAmount: 10_000,
          creditAmount: 10_000,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects an entry referencing an account from another tenant", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const bankA = await createAccount(enterpriseA.id, "521000");
    const salesB = await createAccount(enterpriseB.id, "701000");

    await expect(
      asTenant(enterpriseA.id, () =>
        repository.create(enterpriseA.id, {
          description: "Tentative cross-tenant",
          lines: [
            { accountId: bankA.id, debitAmount: 1_000, creditAmount: 0 },
            { accountId: salesB.id, debitAmount: 0, creditAmount: 1_000 },
          ],
        }),
      ),
    ).rejects.toThrow(NotFoundException);

    const entries = await prisma.journalEntry.findMany({ where: { enterpriseId: enterpriseA.id } });
    expect(entries).toHaveLength(0);
  });

  it("filters the list by accountId (grand livre d'un compte)", async () => {
    const enterprise = await createEnterprise();
    const bank = await createAccount(enterprise.id, "521000");
    const sales = await createAccount(enterprise.id, "701000");
    const other = await createAccount(enterprise.id, "601000");

    await asTenant(enterprise.id, () =>
      createEntry(enterprise.id, {
        description: "Concerne banque",
        lines: [
          { accountId: bank.id, debitAmount: 1_000, creditAmount: 0 },
          { accountId: sales.id, debitAmount: 0, creditAmount: 1_000 },
        ],
      }),
    );
    await asTenant(enterprise.id, () =>
      createEntry(enterprise.id, {
        description: "Ne concerne pas banque",
        lines: [
          { accountId: other.id, debitAmount: 500, creditAmount: 0 },
          { accountId: sales.id, debitAmount: 0, creditAmount: 500 },
        ],
      }),
    );

    const result = await asTenant(enterprise.id, () =>
      repository.findMany(enterprise.id, { page: 1, pageSize: 20, accountId: bank.id }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].description).toBe("Concerne banque");
  });

  // Régression MOBILE AUDIT-001/ERP-001 (docs/adr/0019-...) : un rejeu ne
  // doit jamais créer une seconde écriture ni consommer un nouveau numéro.
  it("returns the same entry without creating a duplicate when the same idempotency key is replayed", async () => {
    const enterprise = await createEnterprise();
    const bank = await createAccount(enterprise.id, "521000");
    const sales = await createAccount(enterprise.id, "701000");
    const key = randomUUID();
    const input = {
      description: "Écriture rejouée",
      lines: [
        { accountId: bank.id, debitAmount: 1_000, creditAmount: 0 },
        { accountId: sales.id, debitAmount: 0, creditAmount: 1_000 },
      ],
    };

    const first = await asTenant(enterprise.id, () => repository.create(enterprise.id, input, key));
    const second = await asTenant(enterprise.id, () => repository.create(enterprise.id, input, key));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.view.id).toBe(first.view.id);
    expect(second.view.number).toBe(first.view.number);

    const entries = await prisma.journalEntry.findMany({ where: { enterpriseId: enterprise.id } });
    expect(entries).toHaveLength(1);
  });

  it("creates two distinct entries, each with its own number, when the idempotency key differs", async () => {
    const enterprise = await createEnterprise();
    const bank = await createAccount(enterprise.id, "521000");
    const sales = await createAccount(enterprise.id, "701000");
    const input = {
      description: "Écriture",
      lines: [
        { accountId: bank.id, debitAmount: 1_000, creditAmount: 0 },
        { accountId: sales.id, debitAmount: 0, creditAmount: 1_000 },
      ],
    };

    const first = await asTenant(enterprise.id, () => createEntry(enterprise.id, input, randomUUID()));
    const second = await asTenant(enterprise.id, () => createEntry(enterprise.id, input, randomUUID()));

    expect(first.id).not.toBe(second.id);
    expect(first.number).not.toBe(second.number);
    const entries = await prisma.journalEntry.findMany({ where: { enterpriseId: enterprise.id } });
    expect(entries).toHaveLength(2);
  });

  it("throws NotFoundException when reading an entry that belongs to another enterprise", async () => {
    const enterpriseA = await createEnterprise();
    const enterpriseB = await createEnterprise();
    const bankB = await createAccount(enterpriseB.id, "521000");
    const salesB = await createAccount(enterpriseB.id, "701000");

    const entryB = await asTenant(enterpriseB.id, () =>
      createEntry(enterpriseB.id, {
        description: "Vente B",
        lines: [
          { accountId: bankB.id, debitAmount: 1_000, creditAmount: 0 },
          { accountId: salesB.id, debitAmount: 0, creditAmount: 1_000 },
        ],
      }),
    );

    await expect(
      asTenant(enterpriseA.id, () => repository.findByIdOrThrow(enterpriseA.id, entryB.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
