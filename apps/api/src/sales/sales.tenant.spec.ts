import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { createSetupAdmin, createTenantFixtureTracking, cleanupTenantFixtures, TenantFixture } from "../../test/tenant-fixtures";

// Suite test:tenant — copie conforme de stock.tenant.spec.ts (module 5 de la
// Phase 8) : GET /sales/:id d'un autre tenant => 404 (pas 403), GET /sales
// ne fuit jamais vers un autre tenant, et un customerId/productId d'un autre
// tenant dans le body de création est rejeté (404), jamais scopé
// silencieusement — équivalent naturel de "enterpriseId forgé" pour un
// module qui n'a pas de champ enterpriseId direct dans son body.
describe("SalesController — tenant isolation (integration)", () => {
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
    await prisma.saleLine.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.sale.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.customer.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await cleanupTenantFixtures(prisma, tracking);
    await app.close();
  });

  function createCustomer(enterpriseId: string) {
    return prisma.customer.create({ data: { enterpriseId, type: "COMPANY", name: "Client test" } });
  }

  function createProduct(enterpriseId: string) {
    return prisma.product.create({
      data: { enterpriseId, code: `SKU-${randomUUID()}`, name: "Produit test", sellingPriceExcludingTax: 1_000, trackStock: false },
    });
  }

  it("returns 404 (not 403) when reading another tenant's sale by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");
    const customerB = await createCustomer(tenantB.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    const created = await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ customerId: customerB.id, lines: [{ productId: productB.id, quantity: 1 }] })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/sales/${created.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's sales from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");
    const customerA = await createCustomer(tenantA.enterpriseId);
    const productA = await createProduct(tenantA.enterpriseId);
    const customerB = await createCustomer(tenantB.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    const saleA = await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ customerId: customerA.id, lines: [{ productId: productA.id, quantity: 1 }] })
      .expect(201);
    await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ customerId: customerB.id, lines: [{ productId: productB.id, quantity: 1 }] })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get("/sales")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    const ids = listA.body.items.map((s: { id: string }) => s.id);
    expect(ids).toContain(saleA.body.id);
    expect(ids).toHaveLength(1);
  });

  it("rejects a sale referencing another tenant's customerId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Customer");
    const tenantB = await setupAdmin("Tenant B Forge Customer");
    const customerB = await createCustomer(tenantB.enterpriseId);
    const productA = await createProduct(tenantA.enterpriseId);

    await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ customerId: customerB.id, lines: [{ productId: productA.id, quantity: 1 }] })
      .expect(404);
  });

  it("rejects a sale referencing another tenant's productId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Product");
    const tenantB = await setupAdmin("Tenant B Forge Product");
    const customerA = await createCustomer(tenantA.enterpriseId);
    const productB = await createProduct(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .post("/sales")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ customerId: customerA.id, lines: [{ productId: productB.id, quantity: 1 }] })
      .expect(404);

    const sales = await prisma.sale.findMany({ where: { customerId: customerA.id } });
    expect(sales).toHaveLength(0);
  });
});
