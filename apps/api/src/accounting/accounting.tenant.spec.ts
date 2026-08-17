import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { createSetupAdmin, createTenantFixtureTracking, cleanupTenantFixtures, TenantFixture } from "../../test/tenant-fixtures";

// Suite test:tenant — copie conforme des autres modules Phase 8 : 404 (pas
// 403) sur une ressource d'un autre tenant, aucune fuite dans les listes, et
// un accountId d'un autre tenant dans une ligne d'écriture est rejeté (404),
// jamais scopé silencieusement.
describe("AccountingController — tenant isolation (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let setupAdmin: (label: string) => Promise<TenantFixture>;
  const tracking = createTenantFixtureTracking();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    setupAdmin = createSetupAdmin(app, prisma, app.get(PasswordService), tracking);
  });

  afterAll(async () => {
    await prisma.journalEntryLine.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.journalEntry.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.journalEntryCounter.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.account.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await cleanupTenantFixtures(prisma, tracking);
    await app.close();
  });

  async function createTwoAccounts(auth: { Authorization: string }) {
    const bankRes = await request(app.getHttpServer()).post("/accounting/accounts").set(auth).send({ code: "521000", label: "Banque" }).expect(201);
    const salesRes = await request(app.getHttpServer()).post("/accounting/accounts").set(auth).send({ code: "701000", label: "Ventes" }).expect(201);
    return { bankId: bankRes.body.id as string, salesId: salesRes.body.id as string };
  }

  it("returns 404 (not 403) when reading another tenant's account by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");
    const authB = { Authorization: `Bearer ${tenantB.accessToken}` };

    const accountRes = await request(app.getHttpServer()).post("/accounting/accounts").set(authB).send({ code: "601000", label: "Achats" }).expect(201);

    await request(app.getHttpServer())
      .get(`/accounting/accounts/${accountRes.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's accounts from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");
    const authA = { Authorization: `Bearer ${tenantA.accessToken}` };
    const authB = { Authorization: `Bearer ${tenantB.accessToken}` };

    const accountA = await request(app.getHttpServer()).post("/accounting/accounts").set(authA).send({ code: "601000", label: "Achats A" }).expect(201);
    await request(app.getHttpServer()).post("/accounting/accounts").set(authB).send({ code: "601000", label: "Achats B" }).expect(201);

    const listA = await request(app.getHttpServer()).get("/accounting/accounts").set(authA).expect(200);
    const ids = listA.body.items.map((a: { id: string }) => a.id);
    expect(ids).toContain(accountA.body.id);
    expect(ids).toHaveLength(1);
  });

  it("returns 404 (not 403) when reading another tenant's journal entry by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A Entry");
    const tenantB = await setupAdmin("Tenant B Entry");
    const authB = { Authorization: `Bearer ${tenantB.accessToken}` };
    const { bankId, salesId } = await createTwoAccounts(authB);

    const entryRes = await request(app.getHttpServer())
      .post("/accounting/journal-entries")
      .set(authB)
      .send({
        description: "Vente B",
        lines: [
          { accountId: bankId, debitAmount: 1_000, creditAmount: 0 },
          { accountId: salesId, debitAmount: 0, creditAmount: 1_000 },
        ],
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/accounting/journal-entries/${entryRes.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("rejects a journal entry line referencing another tenant's accountId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Account");
    const tenantB = await setupAdmin("Tenant B Forge Account");
    const authA = { Authorization: `Bearer ${tenantA.accessToken}` };
    const authB = { Authorization: `Bearer ${tenantB.accessToken}` };

    const { bankId: bankA } = await createTwoAccounts(authA);
    const { salesId: salesB } = await createTwoAccounts(authB);

    await request(app.getHttpServer())
      .post("/accounting/journal-entries")
      .set(authA)
      .send({
        description: "Tentative cross-tenant",
        lines: [
          { accountId: bankA, debitAmount: 1_000, creditAmount: 0 },
          { accountId: salesB, debitAmount: 0, creditAmount: 1_000 },
        ],
      })
      .expect(404);

    const entries = await prisma.journalEntry.findMany({ where: { enterpriseId: tenantA.enterpriseId } });
    expect(entries).toHaveLength(0);
  });
});
