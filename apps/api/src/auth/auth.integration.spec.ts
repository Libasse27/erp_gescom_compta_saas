import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "./password.service";

describe("Auth (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;

  const testRunId = randomUUID();
  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    // Le rate limiting /auth/* est désactivé en pratique sous NODE_ENV=test
    // (voir common/rate-limit.ts) : ce fichier enchaîne volontairement plus
    // de requêtes que la limite de production ne le permettrait.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await app.close();
  });

  async function createTestUser(overrides: { password?: string } = {}) {
    const enterprise = await prisma.enterprise.create({
      data: { name: `Test Enterprise ${testRunId}-${createdEnterpriseIds.length}` },
    });
    createdEnterpriseIds.push(enterprise.id);

    const plainPassword = overrides.password ?? "CorrectHorseBattery9!";
    const user = await prisma.user.create({
      data: {
        email: `user-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(plainPassword),
        firstName: "Test",
        lastName: "User",
        enterpriseId: enterprise.id,
        status: "ACTIVE",
      },
    });

    return { user, enterprise, plainPassword };
  }

  it("logs in with valid credentials, returns tokens, and records a LOGIN audit entry", async () => {
    const { user, plainPassword } = await createTestUser();

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);

    expect(res.body.mfaRequired).toBe(false);
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");

    const logs = await prisma.auditLog.findMany({ where: { userId: user.id, action: "LOGIN" } });
    expect(logs).toHaveLength(1);
  });

  it("rejects an invalid password with a generic error and records LOGIN_FAILED", async () => {
    const { user } = await createTestUser();

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: "wrong-password" })
      .expect(401);

    expect(res.body.message).toBe("Identifiants invalides");

    const logs = await prisma.auditLog.findMany({ where: { userId: user.id, action: "LOGIN_FAILED" } });
    expect(logs).toHaveLength(1);
  });

  it("locks the account after 5 failed attempts and records ACCOUNT_LOCKED", async () => {
    const { user } = await createTestUser();

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: user.email, password: "wrong-password" })
        .expect(401);
    }

    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil).not.toBeNull();
    expect(locked.failedLoginCount).toBe(5);

    const lockLogs = await prisma.auditLog.findMany({ where: { userId: user.id, action: "ACCOUNT_LOCKED" } });
    expect(lockLogs).toHaveLength(1);

    // Le compte reste bloqué même avec le bon mot de passe tant que le
    // verrou n'a pas expiré.
    const { plainPassword } = { plainPassword: "CorrectHorseBattery9!" };
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(401);
  });

  it("allows login again once the lock has expired", async () => {
    const { user, plainPassword } = await createTestUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);
  });

  it("rejects login for a SUSPENDED user with the generic error (SEC-03)", async () => {
    const { user, plainPassword } = await createTestUser();
    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });

    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(401);

    expect(res.body.message).toBe("Identifiants invalides");

    const logs = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "LOGIN_FAILED", metadata: { path: ["reason"], equals: "account_inactive" } },
    });
    expect(logs).toHaveLength(1);
  });

  it("rejects login for an active user of a SUSPENDED enterprise (SEC-03)", async () => {
    const { user, enterprise, plainPassword } = await createTestUser();
    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { status: "SUSPENDED" } });

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(401);
  });

  it("rejects refresh once the enterprise is suspended after login, revoking the whole family (SEC-03)", async () => {
    const { user, enterprise, plainPassword } = await createTestUser();

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);

    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { status: "SUSPENDED" } });

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(401);

    const logs = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "REFRESH_REJECTED_INACTIVE_ACCOUNT" },
    });
    expect(logs).toHaveLength(1);
  });

  // Régression BIL-04 (docs/audit/BILLING-AUDIT.md) : distincte du test
  // SEC-03 ci-dessus (qui ne rejette qu'au prochain /auth/refresh). Ici,
  // aucun refresh n'est tenté : l'access token déjà émis, toujours valide
  // au sens de sa signature/expiration, doit être rejeté sur la requête
  // suivante par JwtAuthGuard lui-même, pas seulement au refresh.
  it("rejects an already-issued access token immediately once the enterprise is suspended (BIL-04)", async () => {
    const { user, enterprise, plainPassword } = await createTestUser();

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .expect(200);

    await prisma.enterprise.update({ where: { id: enterprise.id }, data: { status: "SUSPENDED" } });

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .expect(401);
  });

  it("rejects an already-issued access token immediately once the user is suspended (BIL-04)", async () => {
    const { user, plainPassword } = await createTestUser();

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);

    await prisma.user.update({ where: { id: user.id }, data: { status: "SUSPENDED" } });

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .expect(401);
  });

  it("rotates the refresh token and rejects the old one on reuse, revoking the whole family", async () => {
    const { user, plainPassword } = await createTestUser();

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);

    const firstRefreshToken = loginRes.body.refreshToken as string;

    const refreshRes = await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: firstRefreshToken })
      .expect(200);

    const secondRefreshToken = refreshRes.body.refreshToken as string;
    expect(secondRefreshToken).not.toBe(firstRefreshToken);

    // Réutilisation du (premier) token déjà "rotated" : doit être rejetée et
    // révoquer toute la famille, y compris le token courant (secondRefreshToken).
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: firstRefreshToken })
      .expect(401);

    const reuseLogs = await prisma.auditLog.findMany({
      where: { userId: user.id, action: "REFRESH_TOKEN_REUSE_DETECTED" },
    });
    expect(reuseLogs).toHaveLength(1);

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: secondRefreshToken })
      .expect(401);
  });

  it("logs out, revoking the refresh token family and recording LOGOUT", async () => {
    const { user, plainPassword } = await createTestUser();

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);

    const { accessToken, refreshToken } = loginRes.body;

    await request(app.getHttpServer())
      .post("/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);

    await request(app.getHttpServer()).post("/auth/refresh").send({ refreshToken }).expect(401);

    const logoutLogs = await prisma.auditLog.findMany({ where: { userId: user.id, action: "LOGOUT" } });
    expect(logoutLogs).toHaveLength(1);
  });

  it("rejects /auth/me without a Bearer token and accepts it with one", async () => {
    const { user, plainPassword } = await createTestUser();

    await request(app.getHttpServer()).get("/auth/me").expect(401);

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: plainPassword })
      .expect(200);

    const meRes = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .expect(200);

    expect(meRes.body.id).toBe(user.id);
    expect(meRes.body.email).toBe(user.email);
  });
});
