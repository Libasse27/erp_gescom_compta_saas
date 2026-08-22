import { Test } from "@nestjs/testing";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Corrige SEC-05 (docs/audit/SECURITY-AUDIT.md) : sans `app.set("trust
// proxy", 1)` (main.ts), Express utilise l'IP de connexion TCP (celle de
// Caddy en prod/staging) comme req.ip et ignore X-Forwarded-For — faussant
// le rate limiting par IP et l'IP enregistrée dans le journal d'audit. Ce
// test reproduit exactement le réglage de main.ts (les tests d'intégration
// construisent l'app via Test.createTestingModule, pas via bootstrap()) et
// prouve, via une entrée d'audit réelle, que l'IP transmise par un unique
// proxy de confiance est bien celle retenue.
describe("Express trust proxy — audit log IP (integration)", () => {
  let app: NestExpressApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set("trust proxy", 1);
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await app.close();
  });

  it("records the client IP from a trusted X-Forwarded-For header, not the proxy's own address", async () => {
    const enterprise = await prisma.enterprise.create({
      data: { name: `Test Enterprise ${randomUUID()}` },
    });
    createdEnterpriseIds.push(enterprise.id);

    const user = await prisma.user.create({
      data: {
        email: `user-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash("CorrectHorseBattery9!"),
        firstName: "Test",
        lastName: "User",
        enterpriseId: enterprise.id,
        status: "ACTIVE",
      },
    });

    const forwardedClientIp = "203.0.113.42";

    await request(app.getHttpServer())
      .post("/auth/login")
      .set("X-Forwarded-For", forwardedClientIp)
      .send({ email: user.email, password: "wrong-password" })
      .expect(401);

    const [log] = await prisma.auditLog.findMany({ where: { userId: user.id, action: "LOGIN_FAILED" } });
    expect(log.ipAddress).toBe(forwardedClientIp);
  });
});
