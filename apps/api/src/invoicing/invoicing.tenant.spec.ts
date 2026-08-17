import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import { createSetupAdmin, createTenantFixtureTracking, cleanupTenantFixtures, TenantFixture } from "../../test/tenant-fixtures";

// Suite test:tenant — copie conforme de sales.tenant.spec.ts/
// purchases.tenant.spec.ts (modules 5 et 6) : GET /invoices/:id d'un autre
// tenant => 404 (pas 403), GET /invoices ne fuit jamais vers un autre
// tenant, et un saleId d'un autre tenant dans le body de création est
// rejeté (404), jamais scopé silencieusement.
describe("InvoicingController — tenant isolation (integration)", () => {
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
    await prisma.salesInvoice.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.salesInvoiceCounter.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.saleLine.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.sale.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.customer.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await cleanupTenantFixtures(prisma, tracking);
    await app.close();
  });

  async function createConfirmedSale(enterpriseId: string) {
    const customer = await prisma.customer.create({ data: { enterpriseId, type: "COMPANY", name: "Client test" } });
    const product = await prisma.product.create({
      data: { enterpriseId, code: `SKU-${randomUUID()}`, name: "Produit test", sellingPriceExcludingTax: 1_000, trackStock: false },
    });
    return prisma.sale.create({
      data: {
        enterpriseId,
        customerId: customer.id,
        status: "CONFIRMED",
        confirmedAt: new Date(),
        lines: { create: { enterpriseId, productId: product.id, quantity: 1, unitPriceExcludingTax: 1_000, vatRateBasisPoints: 1_800 } },
      },
    });
  }

  it("returns 404 (not 403) when reading another tenant's invoice by a guessed id", async () => {
    const tenantA = await setupAdmin("Tenant A");
    const tenantB = await setupAdmin("Tenant B");
    const saleB = await createConfirmedSale(tenantB.enterpriseId);

    const created = await request(app.getHttpServer())
      .post("/invoices")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ saleId: saleB.id })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/invoices/${created.body.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("never returns another tenant's invoices from the list endpoint", async () => {
    const tenantA = await setupAdmin("Tenant A List");
    const tenantB = await setupAdmin("Tenant B List");
    const saleA = await createConfirmedSale(tenantA.enterpriseId);
    const saleB = await createConfirmedSale(tenantB.enterpriseId);

    const invoiceA = await request(app.getHttpServer())
      .post("/invoices")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ saleId: saleA.id })
      .expect(201);
    await request(app.getHttpServer())
      .post("/invoices")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ saleId: saleB.id })
      .expect(201);

    const listA = await request(app.getHttpServer())
      .get("/invoices")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);

    const ids = listA.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(invoiceA.body.id);
    expect(ids).toHaveLength(1);
  });

  it("rejects an invoice referencing another tenant's saleId (404), never scoped to the caller's tenant", async () => {
    const tenantA = await setupAdmin("Tenant A Forge Sale");
    const tenantB = await setupAdmin("Tenant B Forge Sale");
    const saleB = await createConfirmedSale(tenantB.enterpriseId);

    await request(app.getHttpServer())
      .post("/invoices")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ saleId: saleB.id })
      .expect(404);

    const invoices = await prisma.salesInvoice.findMany({ where: { saleId: saleB.id } });
    expect(invoices).toHaveLength(0);
  });
});
