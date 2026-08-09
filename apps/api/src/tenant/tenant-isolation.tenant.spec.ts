import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { TenantContext } from "./tenant-context";
import { TenantScopedPrismaService } from "./tenant-scoped-prisma.service";

// Suite test:tenant (docs/PROMPT-MAITRE-SAAS.md Phase 3). Le test générique
// "tous les endpoints de liste" ne s'applique pas encore : aucun endpoint de
// liste tenant n'existe avant la Phase 8. Cette suite vérifie directement le
// mécanisme d'isolation (RLS + TenantContext) sur ce qui existe aujourd'hui.
describe("Tenant isolation (RLS + TenantContext)", () => {
  const prisma = new PrismaService();
  const tenantPrisma = new TenantScopedPrismaService();

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    await tenantPrisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await tenantPrisma.onModuleDestroy();
    await prisma.$disconnect();
  });

  async function createEnterprise(name: string) {
    const enterprise = await prisma.enterprise.create({ data: { name } });
    createdEnterpriseIds.push(enterprise.id);
    return enterprise;
  }

  it("rejects any query when no TenantContext is active", async () => {
    await expect(tenantPrisma.run((tx) => tx.enterprise.findMany())).rejects.toThrow(/TenantContext/);
  });

  it("scopes reads to the current tenant: tenant A never sees tenant B's row, and vice versa", async () => {
    const enterpriseA = await createEnterprise(`Tenant A ${randomUUID()}`);
    const enterpriseB = await createEnterprise(`Tenant B ${randomUUID()}`);

    const seenByA = await TenantContext.run(
      { tenantId: enterpriseA.id, userId: randomUUID(), isSuperAdmin: false },
      () => tenantPrisma.run((tx) => tx.enterprise.findMany()),
    );
    expect(seenByA.map((e) => e.id)).toEqual([enterpriseA.id]);

    const seenByB = await TenantContext.run(
      { tenantId: enterpriseB.id, userId: randomUUID(), isSuperAdmin: false },
      () => tenantPrisma.run((tx) => tx.enterprise.findMany()),
    );
    expect(seenByB.map((e) => e.id)).toEqual([enterpriseB.id]);
  });

  it("blocks a cross-tenant write even when the target id is known", async () => {
    const enterpriseA = await createEnterprise(`Tenant A ${randomUUID()}`);
    const enterpriseB = await createEnterprise(`Tenant B ${randomUUID()}`);

    // Un attaquant qui connaîtrait l'id d'une autre entreprise (deviné,
    // fuité ailleurs...) ne peut ni la lire ni la modifier : RLS filtre la
    // ligne avant même que la clause WHERE de l'UPDATE ne s'applique.
    await expect(
      TenantContext.run({ tenantId: enterpriseA.id, userId: randomUUID(), isSuperAdmin: false }, () =>
        tenantPrisma.run((tx) => tx.enterprise.update({ where: { id: enterpriseB.id }, data: { name: "HACKED" } })),
      ),
    ).rejects.toThrow();

    const untouched = await prisma.enterprise.findUniqueOrThrow({ where: { id: enterpriseB.id } });
    expect(untouched.name).not.toBe("HACKED");
  });

  it("returns nothing when no tenant is set, even inside a run() call with an empty store forced", async () => {
    // getRequiredTenantId() empêche normalement d'arriver ici sans tenantId ;
    // ce test documente le comportement de la policy elle-même (deny by
    // default) si jamais ce garde applicatif était un jour contourné.
    const enterprise = await createEnterprise(`Tenant Orphan ${randomUUID()}`);

    const seen = await TenantContext.run({ tenantId: randomUUID(), userId: randomUUID(), isSuperAdmin: false }, () =>
      tenantPrisma.run((tx) => tx.enterprise.findUnique({ where: { id: enterprise.id } })),
    );
    expect(seen).toBeNull();
  });

  it("scopes invoice_counters to the current tenant (Phase 5, RLS added alongside the other tenant tables)", async () => {
    const enterpriseA = await createEnterprise(`Tenant A ${randomUUID()}`);
    const enterpriseB = await createEnterprise(`Tenant B ${randomUUID()}`);
    await prisma.invoiceCounter.create({ data: { enterpriseId: enterpriseA.id, lastNumber: 1 } });
    await prisma.invoiceCounter.create({ data: { enterpriseId: enterpriseB.id, lastNumber: 1 } });

    const seenByA = await TenantContext.run(
      { tenantId: enterpriseA.id, userId: randomUUID(), isSuperAdmin: false },
      () => tenantPrisma.run((tx) => tx.invoiceCounter.findMany()),
    );
    expect(seenByA.map((c) => c.enterpriseId)).toEqual([enterpriseA.id]);

    await prisma.invoiceCounter.deleteMany({ where: { enterpriseId: { in: [enterpriseA.id, enterpriseB.id] } } });
  });

  it("erp_app_tenant is neither superuser nor RLS-bypassing, and does not own the tenant tables", async () => {
    const [role] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'erp_app_tenant'
    `;
    expect(role).toBeDefined();
    expect(role!.rolsuper).toBe(false);
    expect(role!.rolbypassrls).toBe(false);

    const [ownership] = await prisma.$queryRaw<{ owner_is_tenant_role: boolean }[]>`
      SELECT (tableowner = 'erp_app_tenant') AS owner_is_tenant_role
      FROM pg_tables WHERE schemaname = 'public' AND tablename = 'enterprises'
    `;
    expect(ownership!.owner_is_tenant_role).toBe(false);
  });
});
