import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { createSetupAdmin, createTenantFixtureTracking, cleanupTenantFixtures, TenantFixture } from "../../test/tenant-fixtures";

// Suite test:tenant — copie conforme de products.tenant.spec.ts (module 4
// de la Phase 8), adaptée : pas d'"enterpriseId forgé dans le body" ici
// (Stock n'a pas de route de création de fiche), remplacé par l'équivalent
// naturel du module — un productId d'un autre tenant referencé dans
// POST /stock/movements doit être rejeté (404), jamais scopé silencieusement.
describe("StockController — tenant isolation (integration)", () => {
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
    await prisma.stockMovement.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await cleanupTenantFixtures(prisma, tracking);
    await app.close();
  });

  function createProduct(enterpriseId: string) {
    return prisma.product.create({
      data: { enterpriseId, code: `SKU-${randomUUID()}`, name: "Produit test", sellingPriceExcludingTax: 1_000 },
    });
  }

  it("returns 404 (not 403) when reading another tenant's stock level by a guessed productId", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");
    const productB = await createProduct(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .get(`/stock/${productB.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's stock levels from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");
    const productA = await createProduct(tenantA.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .post("/stock/movements")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ productId: productA.id, type: "IN", quantity: 10 })
      .expect(201);
    await request(app.getHttpServer())
      .post("/stock/movements")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ productId: productB.id, type: "IN", quantity: 10 })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get("/stock")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    const ids = listA.body.items.map((item: { productId: string }) => item.productId);
    expect(ids).toContain(productA.id);
    expect(ids).not.toContain(productB.id);
  });

  it("rejects a movement referencing another tenant's productId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge");
    const tenantB = await setupAdmin("Tenant B Forge");
    const productB = await createProduct(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .post("/stock/movements")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ productId: productB.id, type: "IN", quantity: 10 })
      .expect(404);

    const movements = await prisma.stockMovement.findMany({ where: { productId: productB.id } });
    expect(movements).toHaveLength(0);
  });
});
