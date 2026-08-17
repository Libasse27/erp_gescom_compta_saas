import "reflect-metadata";
import { INestApplication, RequestMethod } from "@nestjs/common";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { DiscoveryModule, DiscoveryService, MetadataScanner } from "@nestjs/core";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";
import {
  createSetupAdmin,
  createTenantFixtureTracking,
  cleanupTenantFixtures,
  TenantFixture,
} from "../../test/tenant-fixtures";

// Suite test:tenant — couvre le 5ᵉ scénario obligatoire de CLAUDE.md §5
// ("toute liste retournée par un endpoint ne contient que des documents de
// A") de façon STRUCTURELLE plutôt que par duplication module par module
// (docs/audit/PROJECT-AUDIT.md, constat MEDIUM : la couverture existante,
// un test quasi identique recopié dans chaque *.tenant.spec.ts, n'aurait
// jamais détecté l'oubli d'un futur endpoint de liste). Deux mécanismes :
// 1. LIST_ENDPOINTS — un registre explicite, table-driven, de tous les
//    endpoints GET tenant-scoped renvoyant une collection connus à ce jour.
// 2. Le dernier test ("every registered...") énumère les routes GET
//    RÉELLEMENT enregistrées par l'application (via DiscoveryService, pas
//    une liste maintenue à la main en double) et échoue si l'une d'elles
//    n'a ni entrée dans le registre, ni exclusion explicite justifiée —
//    c'est ce qui rend un futur oubli détectable en CI plutôt que silencieux.
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface ListEndpointCase {
  name: string;
  path: string;
  extractMarkers: (body: unknown) => string[];
  // Crée un enregistrement pour ce tenant et retourne son marqueur (id, ou
  // clé pour /settings qui n'expose pas d'id — voir SettingSummary).
  seed: (tenant: TenantFixture) => Promise<string>;
}

describe("Generic list endpoints — tenant isolation (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let setupAdmin: (label: string) => Promise<TenantFixture>;
  let discoveryService: DiscoveryService;
  let metadataScanner: MetadataScanner;
  const tracking = createTenantFixtureTracking();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    setupAdmin = createSetupAdmin(app, prisma, app.get(PasswordService), tracking);
    discoveryService = moduleRef.get(DiscoveryService);
    metadataScanner = moduleRef.get(MetadataScanner);
  });

  afterAll(async () => {
    // Toutes les entités métier créées par ce fichier référencent
    // enterpriseId (contrainte FK) — nettoyées avant les tenants eux-mêmes,
    // lignes avant en-têtes, en-têtes avant fiches référencées.
    await prisma.journalEntryLine.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.journalEntry.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.journalEntryCounter.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.account.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.salesInvoice.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.salesInvoiceCounter.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.purchaseLine.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.purchase.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.saleLine.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.sale.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.stockMovement.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.setting.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.product.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.customer.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await prisma.supplier.deleteMany({ where: { enterpriseId: { in: tracking.enterpriseIds } } });
    await cleanupTenantFixtures(prisma, tracking);
    await app.close();
  });

  const LIST_ENDPOINTS: ListEndpointCase[] = [
    {
      name: "GET /customers",
      path: "/customers",
      extractMarkers: (body) => (body as { items: { id: string }[] }).items.map((i) => i.id),
      seed: async (tenant) => {
        const res = await request(app.getHttpServer())
          .post("/customers")
          .set(auth(tenant.accessToken))
          .send({ type: "COMPANY", name: `Seed ${randomUUID()}` })
          .expect(201);
        return res.body.id as string;
      },
    },
    {
      name: "GET /suppliers",
      path: "/suppliers",
      extractMarkers: (body) => (body as { items: { id: string }[] }).items.map((i) => i.id),
      seed: async (tenant) => {
        const res = await request(app.getHttpServer())
          .post("/suppliers")
          .set(auth(tenant.accessToken))
          .send({ type: "COMPANY", name: `Seed ${randomUUID()}` })
          .expect(201);
        return res.body.id as string;
      },
    },
    {
      name: "GET /products",
      path: "/products",
      extractMarkers: (body) => (body as { items: { id: string }[] }).items.map((i) => i.id),
      seed: async (tenant) => {
        const res = await request(app.getHttpServer())
          .post("/products")
          .set(auth(tenant.accessToken))
          .send({ code: `SKU-${randomUUID()}`, name: "Seed", sellingPriceExcludingTax: 1_000 })
          .expect(201);
        return res.body.id as string;
      },
    },
    {
      name: "GET /stock",
      path: "/stock",
      extractMarkers: (body) => (body as { items: { productId: string }[] }).items.map((i) => i.productId),
      seed: async (tenant) => {
        const res = await request(app.getHttpServer())
          .post("/products")
          .set(auth(tenant.accessToken))
          .send({ code: `SKU-${randomUUID()}`, name: "Seed stock", sellingPriceExcludingTax: 1_000, trackStock: true })
          .expect(201);
        return res.body.id as string;
      },
    },
    {
      name: "GET /sales",
      path: "/sales",
      extractMarkers: (body) => (body as { items: { id: string }[] }).items.map((i) => i.id),
      seed: async (tenant) => {
        const customerRes = await request(app.getHttpServer())
          .post("/customers")
          .set(auth(tenant.accessToken))
          .send({ type: "COMPANY", name: `Seed client ${randomUUID()}` })
          .expect(201);
        const productRes = await request(app.getHttpServer())
          .post("/products")
          .set(auth(tenant.accessToken))
          .send({ code: `SKU-${randomUUID()}`, name: "Seed produit vente", sellingPriceExcludingTax: 1_000, trackStock: false })
          .expect(201);
        const saleRes = await request(app.getHttpServer())
          .post("/sales")
          .set(auth(tenant.accessToken))
          .send({ customerId: customerRes.body.id, lines: [{ productId: productRes.body.id, quantity: 1 }] })
          .expect(201);
        return saleRes.body.id as string;
      },
    },
    {
      name: "GET /purchases",
      path: "/purchases",
      extractMarkers: (body) => (body as { items: { id: string }[] }).items.map((i) => i.id),
      seed: async (tenant) => {
        const supplierRes = await request(app.getHttpServer())
          .post("/suppliers")
          .set(auth(tenant.accessToken))
          .send({ type: "COMPANY", name: `Seed fournisseur ${randomUUID()}` })
          .expect(201);
        const productRes = await request(app.getHttpServer())
          .post("/products")
          .set(auth(tenant.accessToken))
          .send({ code: `SKU-${randomUUID()}`, name: "Seed produit achat", sellingPriceExcludingTax: 1_000, trackStock: false })
          .expect(201);
        const purchaseRes = await request(app.getHttpServer())
          .post("/purchases")
          .set(auth(tenant.accessToken))
          .send({ supplierId: supplierRes.body.id, lines: [{ productId: productRes.body.id, quantity: 1, unitCostExcludingTax: 500 }] })
          .expect(201);
        return purchaseRes.body.id as string;
      },
    },
    {
      name: "GET /invoices",
      path: "/invoices",
      extractMarkers: (body) => (body as { items: { id: string }[] }).items.map((i) => i.id),
      seed: async (tenant) => {
        const customerRes = await request(app.getHttpServer())
          .post("/customers")
          .set(auth(tenant.accessToken))
          .send({ type: "COMPANY", name: `Seed client facture ${randomUUID()}` })
          .expect(201);
        const productRes = await request(app.getHttpServer())
          .post("/products")
          .set(auth(tenant.accessToken))
          .send({ code: `SKU-${randomUUID()}`, name: "Seed produit facture", sellingPriceExcludingTax: 1_000, trackStock: false })
          .expect(201);
        const saleRes = await request(app.getHttpServer())
          .post("/sales")
          .set(auth(tenant.accessToken))
          .send({ customerId: customerRes.body.id, lines: [{ productId: productRes.body.id, quantity: 1 }] })
          .expect(201);
        await request(app.getHttpServer())
          .post(`/sales/${saleRes.body.id}/confirm`)
          .set(auth(tenant.accessToken))
          .expect(201);
        const invoiceRes = await request(app.getHttpServer())
          .post("/invoices")
          .set(auth(tenant.accessToken))
          .send({ saleId: saleRes.body.id })
          .expect(201);
        return invoiceRes.body.id as string;
      },
    },
    {
      name: "GET /accounting/accounts",
      path: "/accounting/accounts",
      extractMarkers: (body) => (body as { items: { id: string }[] }).items.map((i) => i.id),
      seed: async (tenant) => {
        const res = await request(app.getHttpServer())
          .post("/accounting/accounts")
          .set(auth(tenant.accessToken))
          .send({ code: "601", label: `Seed ${randomUUID()}` })
          .expect(201);
        return res.body.id as string;
      },
    },
    {
      name: "GET /accounting/journal-entries",
      path: "/accounting/journal-entries",
      extractMarkers: (body) => (body as { items: { id: string }[] }).items.map((i) => i.id),
      seed: async (tenant) => {
        const accountRes = await request(app.getHttpServer())
          .post("/accounting/accounts")
          .set(auth(tenant.accessToken))
          .send({ code: "701", label: `Seed compte écriture ${randomUUID()}` })
          .expect(201);
        const entryRes = await request(app.getHttpServer())
          .post("/accounting/journal-entries")
          .set(auth(tenant.accessToken))
          .send({
            description: `Seed écriture ${randomUUID()}`,
            lines: [
              { accountId: accountRes.body.id, debitAmount: 1_000, creditAmount: 0 },
              { accountId: accountRes.body.id, debitAmount: 0, creditAmount: 1_000 },
            ],
          })
          .expect(201);
        return entryRes.body.id as string;
      },
    },
    {
      name: "GET /users",
      path: "/users",
      extractMarkers: (body) => (body as { id: string }[]).map((u) => u.id),
      // Aucun POST public de création d'utilisateur (seule l'invitation par
      // email existe, hors périmètre ici) : l'admin créé par setupAdmin
      // lui-même sert de marqueur. /users/me/context ne renvoie que
      // permissions/plan/features (pas d'id utilisateur) — seedé directement
      // via Prisma, même stratégie que /settings ci-dessous.
      seed: async (tenant) => {
        const user = await prisma.user.findFirstOrThrow({ where: { enterpriseId: tenant.enterpriseId } });
        return user.id;
      },
    },
    {
      name: "GET /roles",
      path: "/roles",
      extractMarkers: (body) => (body as { id: string }[]).map((r) => r.id),
      // Même remarque que /users : le rôle ADMIN-<uuid> créé par setupAdmin
      // (nom unique par tenant) sert de marqueur, seul rôle existant à ce
      // stade pour ce tenant.
      seed: async (tenant) => {
        const res = await request(app.getHttpServer()).get("/roles").set(auth(tenant.accessToken)).expect(200);
        return (res.body as { id: string }[])[0].id;
      },
    },
    {
      name: "GET /settings",
      path: "/settings",
      extractMarkers: (body) => (body as { key: string }[]).map((s) => s.key),
      // Pas de POST public (lecture seule, voir settings.controller.ts) —
      // seedé directement via Prisma, contrairement aux autres entrées.
      seed: async (tenant) => {
        const key = `seed_marker_${randomUUID()}`;
        await prisma.setting.create({
          data: { scope: "ENTERPRISE", enterpriseId: tenant.enterpriseId, key, value: { marker: true } },
        });
        return key;
      },
    },
  ];

  it.each(LIST_ENDPOINTS.map((c) => [c.name, c] as const))("%s never returns another tenant's data", async (_name, testCase) => {
    const tenantA = await setupAdmin(`Tenant A ${testCase.name}`);
    const tenantB = await setupAdmin(`Tenant B ${testCase.name}`);

    const markerA = await testCase.seed(tenantA);
    const markerB = await testCase.seed(tenantB);

    const res = await request(app.getHttpServer()).get(testCase.path).set(auth(tenantA.accessToken)).expect(200);

    const markers = testCase.extractMarkers(res.body);
    expect(markers).toContain(markerA);
    expect(markers).not.toContain(markerB);
  });

  // /stock/:productId/movements n'est pas un endpoint de liste "plate" (il
  // faut déjà connaître un productId pour l'appeler) — l'invariant tenant
  // pertinent est différent : 404 sur un productId d'un autre tenant, jamais
  // ses mouvements. Couvert ici plutôt que dans LIST_ENDPOINTS, mais déclaré
  // comme couvert au meta-test ci-dessous (voir registeredPathSet).
  it("GET /stock/:productId/movements returns 404 (not the movements) for another tenant's productId", async () => {
    const tenantA = await setupAdmin("Tenant A Stock Movements");
    const tenantB = await setupAdmin("Tenant B Stock Movements");

    const productRes = await request(app.getHttpServer())
      .post("/products")
      .set(auth(tenantB.accessToken))
      .send({ code: `SKU-${randomUUID()}`, name: "Seed stock B", sellingPriceExcludingTax: 1_000, trackStock: true })
      .expect(201);
    await request(app.getHttpServer())
      .post("/stock/movements")
      .set(auth(tenantB.accessToken))
      .send({ productId: productRes.body.id, type: "IN", quantity: 10 })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/stock/${productRes.body.id}/movements`)
      .set(auth(tenantA.accessToken))
      .expect(404);
  });

  // Meta-test structurel : sans lui, un développeur pourrait ajouter un
  // nouvel endpoint de liste tenant-scoped sans jamais l'ajouter au registre
  // ci-dessus — le trou resterait invisible, exactement le constat MEDIUM de
  // docs/audit/PROJECT-AUDIT.md. Énumère les routes GET RÉELLEMENT
  // enregistrées par Nest (via DiscoveryService — API publique, pas une
  // dépendance sur les internals d'Express) et échoue si l'une d'elles n'a
  // ni entrée dans LIST_ENDPOINTS, ni exclusion explicite justifiée.
  it("every registered tenant-scoped GET list route is covered by the registry above", () => {
    const registeredPaths = discoverRegisteredGetPaths(discoveryService, metadataScanner);

    // Hors périmètre volontairement : routes "soi-même"/pré-tenant (auth,
    // onboarding, plans, sondes d'infra), agrégats qui ne sont pas des
    // listes d'enregistrements (rapports, balance), Super Admin (cross-
    // tenant par conception, audité séparément).
    const excluded = new Set<string>([
      "/health",
      "/health/live",
      "/health/ready",
      "/auth/me",
      "/onboarding",
      "/plans",
      "/subscriptions/me",
      "/users/me/context",
      "/accounting/trial-balance",
      "/reports/sales",
      "/reports/purchases",
      "/reports/income-statement",
    ]);

    const registeredPathSet = new Set(LIST_ENDPOINTS.map((c) => c.path));
    registeredPathSet.add("/stock/:productId/movements");

    // GET /xxx/:id (lecture d'une seule ressource) : la couverture 404-vs-403
    // de chaque ressource individuelle vit dans son propre *.tenant.spec.ts,
    // pas dans ce registre de listes.
    const singleResourcePattern = /\/:[^/]+$/;

    const uncovered = registeredPaths.filter((path) => {
      if (excluded.has(path)) return false;
      if (singleResourcePattern.test(path)) return false;
      if (path.startsWith("/admin")) return false; // Super Admin, cross-tenant par conception
      return !registeredPathSet.has(path);
    });

    expect(uncovered).toEqual([]);
  });
});

function discoverRegisteredGetPaths(discoveryService: DiscoveryService, metadataScanner: MetadataScanner): string[] {
  const paths: string[] = [];
  const controllers = discoveryService.getControllers();

  for (const wrapper of controllers) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;

    const controllerPath = (Reflect.getMetadata(PATH_METADATA, metatype) as string | undefined) ?? "/";
    const prototype = Object.getPrototypeOf(instance);
    const methodNames = metadataScanner.getAllMethodNames(prototype);

    for (const methodName of methodNames) {
      const handler = prototype[methodName];
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method !== RequestMethod.GET) continue;

      const methodPath = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? "/";
      paths.push(joinPaths(controllerPath, methodPath));
    }
  }

  return [...new Set(paths)];
}

// @Controller()/@Get() acceptent des chemins avec ou sans slash de tête, et
// peuvent eux-mêmes contenir des slashes internes (ex: "accounting/accounts")
// — reconstruit un chemin absolu normalisé plutôt que de supposer un format
// unique, seule façon fiable de retomber sur le même format que
// LIST_ENDPOINTS/excluded ci-dessus.
function joinPaths(controllerPath: string, methodPath: string): string {
  const segments = [controllerPath, methodPath]
    .flatMap((part) => part.split("/"))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return `/${segments.join("/")}`;
}
