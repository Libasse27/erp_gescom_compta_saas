import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { createSetupAdmin, createTenantFixtureTracking, cleanupTenantFixtures, TenantFixture } from "../../test/tenant-fixtures";

// Suite test:tenant — copie conforme de customers.tenant.spec.ts (module 2
// de la Phase 8) : GET /suppliers/:id d'un autre tenant => 404 (pas 403),
// GET /suppliers ne retourne jamais les fournisseurs d'un autre tenant, et un
// enterpriseId forgé dans le corps d'une requête est sans effet.
describe("SuppliersController — tenant isolation (integration)", () => {
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
    await prisma.supplier.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await cleanupTenantFixtures(prisma, tracking);
    await app.close();
  });

  it("returns 404 (not 403) when reading another tenant's supplier by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");

    const created = await request(app.getHttpServer())
      .post("/suppliers")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ type: "COMPANY", name: "Fournisseur de B" })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/suppliers/${created.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's suppliers from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");

    await request(app.getHttpServer())
      .post("/suppliers")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ type: "COMPANY", name: "Fournisseur de A" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/suppliers")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ type: "COMPANY", name: "Fournisseur de B" })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get("/suppliers")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    expect(listA.body.items.every((s: { name: string }) => s.name !== "Fournisseur de B")).toBe(true);
    expect(listA.body.items.some((s: { name: string }) => s.name === "Fournisseur de A")).toBe(true);
  });

  it("ignores a forged enterpriseId in the request body and scopes the created row to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge");
    const tenantB = await setupAdmin("Tenant B Forge");

    const created = await request(app.getHttpServer())
      .post("/suppliers")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ type: "COMPANY", name: "Tentative de forge", enterpriseId: tenantB.enterpriseId })
      .expect(201);

    const stored = await prisma.supplier.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.enterpriseId).toBe(tenantA.enterpriseId);
  });
});
