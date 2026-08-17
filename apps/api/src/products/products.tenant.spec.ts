import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { createSetupAdmin, createTenantFixtureTracking, cleanupTenantFixtures, TenantFixture } from "../../test/tenant-fixtures";

// Suite test:tenant — copie conforme de suppliers.tenant.spec.ts (module 3
// de la Phase 8) : GET /products/:id d'un autre tenant => 404 (pas 403),
// GET /products ne retourne jamais les produits d'un autre tenant, et un
// enterpriseId forgé dans le corps d'une requête est sans effet.
describe("ProductsController — tenant isolation (integration)", () => {
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
    await prisma.product.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await cleanupTenantFixtures(prisma, tracking);
    await app.close();
  });

  it("returns 404 (not 403) when reading another tenant's product by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");

    const created = await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ code: `SKU-${randomUUID()}`, name: "Produit de B", sellingPriceExcludingTax: 1_000 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/products/${created.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's products from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");

    await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ code: `SKU-${randomUUID()}`, name: "Produit de A", sellingPriceExcludingTax: 1_000 })
      .expect(201);
    await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ code: `SKU-${randomUUID()}`, name: "Produit de B", sellingPriceExcludingTax: 1_000 })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get("/products")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    expect(listA.body.items.every((p: { name: string }) => p.name !== "Produit de B")).toBe(true);
    expect(listA.body.items.some((p: { name: string }) => p.name === "Produit de A")).toBe(true);
  });

  it("ignores a forged enterpriseId in the request body and scopes the created row to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge");
    const tenantB = await setupAdmin("Tenant B Forge");

    const created = await request(app.getHttpServer())
      .post("/products")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({
        code: `SKU-${randomUUID()}`,
        name: "Tentative de forge",
        sellingPriceExcludingTax: 1_000,
        enterpriseId: tenantB.enterpriseId,
      })
      .expect(201);

    const stored = await prisma.product.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.enterpriseId).toBe(tenantA.enterpriseId);
  });
});
