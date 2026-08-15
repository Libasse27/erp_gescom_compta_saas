import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../../app.module";
import { PrismaService } from "../../prisma/prisma.service";
import { PasswordService } from "../../auth/password.service";

// Phase 10.5 : prouve que RequestContextMiddleware + TenantContextMiddleware
// + HttpLoggingMiddleware, une fois assemblés dans app.module.ts, corrèlent
// réellement chaque ligne de log HTTP avec le requestId (toute requête) et
// le tenantId/userId (requêtes authentifiées seulement) — pas seulement au
// niveau unitaire de StructuredLoggerService (voir structured-logger.service.spec.ts).
describe("HTTP request logging — correlation (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let logSpy: jest.SpyInstance;

  const createdEnterpriseIds: string[] = [];
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);
  });

  afterAll(async () => {
    await prisma.userRole.deleteMany({ where: { user: { enterpriseId: { in: createdEnterpriseIds } } } });
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.rolePermission.deleteMany({ where: { role: { enterpriseId: { in: createdEnterpriseIds } } } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.updateMany({
      where: { id: { in: createdEnterpriseIds } },
      data: { currentSubscriptionId: null },
    });
    await prisma.subscription.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function httpLogLines(): Array<Record<string, unknown>> {
    return logSpy.mock.calls
      .map((call) => {
        try {
          return JSON.parse(call[0] as string) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null && entry.context === "HTTP");
  }

  it("tags an unauthenticated request's HTTP log with a requestId but no tenantId", async () => {
    const res = await request(app.getHttpServer()).get("/plans").expect(200);

    const responseRequestId = res.headers["x-request-id"];
    expect(typeof responseRequestId).toBe("string");

    const [entry] = httpLogLines();
    expect(entry).toMatchObject({ method: "GET", path: "/plans", statusCode: 200 });
    expect(entry.requestId).toBe(responseRequestId);
    expect(entry.tenantId).toBeUndefined();
  });

  it("echoes a client-supplied X-Request-Id instead of generating a new one", async () => {
    const res = await request(app.getHttpServer())
      .get("/plans")
      .set("X-Request-Id", "client-supplied-id-42")
      .expect(200);

    expect(res.headers["x-request-id"]).toBe("client-supplied-id-42");
    const [entry] = httpLogLines();
    expect(entry.requestId).toBe("client-supplied-id-42");
  });

  it("tags an authenticated request's HTTP log with the caller's tenantId and userId", async () => {
    const feature = await prisma.feature.upsert({
      where: { key: "clients" },
      create: { key: "clients", label: "Clients" },
      update: {},
    });

    const plan = await prisma.plan.create({
      data: {
        code: `PLAN_${randomUUID()}`,
        name: "Plan de test",
        priceMonthly: 5_000,
        planFeatures: { create: { featureId: feature.id, enabled: true } },
      },
    });
    createdPlanIds.push(plan.id);

    const enterprise = await prisma.enterprise.create({ data: { name: `Tenant logging ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const subscription = await prisma.subscription.create({
      data: { enterpriseId: enterprise.id, planId: plan.id, status: "ACTIVE", startDate: new Date() },
    });
    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { currentSubscriptionId: subscription.id } });

    const role = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "ADMIN" } });
    const permission = await prisma.permission.upsert({
      where: { key: "clients.read" },
      create: { key: "clients.read" },
      update: {},
    });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });

    const password = "TestPassword9!";
    const user = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Admin",
        lastName: "Logging",
        enterpriseId: enterprise.id,
        status: "ACTIVE",
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password })
      .expect(200);
    const accessToken = loginRes.body.accessToken as string;

    logSpy.mockClear();

    await request(app.getHttpServer())
      .get("/customers")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const [entry] = httpLogLines();
    expect(entry).toMatchObject({ method: "GET", path: "/customers", statusCode: 200 });
    expect(entry.tenantId).toBe(enterprise.id);
    expect(entry.userId).toBe(user.id);
    expect(typeof entry.requestId).toBe("string");
  });
});
