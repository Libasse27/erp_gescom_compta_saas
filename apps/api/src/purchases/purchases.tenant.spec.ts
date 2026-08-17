import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { createSetupAdmin, createTenantFixtureTracking, cleanupTenantFixtures, TenantFixture } from "../../test/tenant-fixtures";

// Suite test:tenant — copie conforme de sales.tenant.spec.ts (module 5) :
// GET /purchases/:id d'un autre tenant => 404 (pas 403), GET /purchases ne
// fuit jamais vers un autre tenant, et un supplierId/productId d'un autre
// tenant dans le body de création est rejeté (404), jamais scopé
// silencieusement.
describe("PurchasesController — tenant isolation (integration)", () => {
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
    await prisma.purchaseLine.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.purchase.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.supplier.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await cleanupTenantFixtures(prisma, tracking);
    await app.close();
  });

  function createSupplier(enterpriseId: string) {
    return prisma.supplier.create({ data: { enterpriseId, type: "COMPANY", name: "Fournisseur test" } });
  }

  function createProduct(enterpriseId: string) {
    return prisma.product.create({
      data: { enterpriseId, code: `SKU-${randomUUID()}`, name: "Produit test", sellingPriceExcludingTax: 1_000, trackStock: false },
    });
  }

  it("returns 404 (not 403) when reading another tenant's purchase by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");
    const supplierB = await createSupplier(tenantB.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    const created = await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ supplierId: supplierB.id, lines: [{ productId: productB.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/purchases/${created.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's purchases from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");
    const supplierA = await createSupplier(tenantA.enterpriseId);
    const productA = await createProduct(tenantA.enterpriseId);
    const supplierB = await createSupplier(tenantB.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    const purchaseA = await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ supplierId: supplierA.id, lines: [{ productId: productA.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(201);
    await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ supplierId: supplierB.id, lines: [{ productId: productB.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get("/purchases")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    const ids = listA.body.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(purchaseA.body.id);
    expect(ids).toHaveLength(1);
  });

  it("rejects a purchase referencing another tenant's supplierId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Supplier");
    const tenantB = await setupAdmin("Tenant B Forge Supplier");
    const supplierB = await createSupplier(tenantB.enterpriseId);
    const productA = await createProduct(tenantA.enterpriseId);

    await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ supplierId: supplierB.id, lines: [{ productId: productA.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(404);
  });

  it("rejects a purchase referencing another tenant's productId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Product");
    const tenantB = await setupAdmin("Tenant B Forge Product");
    const supplierA = await createSupplier(tenantA.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .post("/purchases")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ supplierId: supplierA.id, lines: [{ productId: productB.id, quantity: 1, unitCostExcludingTax: 10 }] })
      .expect(404);

    const purchases = await prisma.purchase.findMany({ where: { supplierId: supplierA.id } });
    expect(purchases).toHaveLength(0);
  });
});
