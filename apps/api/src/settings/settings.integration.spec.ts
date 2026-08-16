import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Phase 7.2 : GET /settings, lecture seule tenant-scoped pour la page
// Paramètres de l'espace entreprise.
describe("SettingsController — GET /settings (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;
  let passwordService: PasswordService;

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
    passwordService = app.get(PasswordService);
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await app.close();
  });

  it("lists the enterprise's settings for a caller with settings.manage", async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: `Settings Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    await prisma.setting.create({
      data: {
        scope: "ENTERPRISE",
        enterpriseId: enterprise.id,
        key: "commercial.defaults",
        value: { currency: "XOF", locale: "fr-SN", timezone: "Africa/Dakar" },
      },
    });

    const role = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "ADMIN" } });
    const perm = await prisma.permission.upsert({
      where: { key: "settings.manage" },
      create: { key: "settings.manage" },
      update: {},
    });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });

    const password = "AdminPassword9!";
    const admin = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Admin",
        lastName: "Test",
        enterpriseId: enterprise.id,
        status: "ACTIVE",
      },
    });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: admin.email, password })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get("/settings")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe("commercial.defaults");
    expect(res.body[0].value).toMatchObject({ currency: "XOF" });
  });

  it("rejects without settings.manage (403)", async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: `Settings Test 2 ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    const role = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "LECTEUR" } });

    const password = "ReaderPassword9!";
    const reader = await prisma.user.create({
      data: {
        email: `reader-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Reader",
        lastName: "Test",
        enterpriseId: enterprise.id,
        status: "ACTIVE",
      },
    });
    await prisma.userRole.create({ data: { userId: reader.id, roleId: role.id } });

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: reader.email, password })
      .expect(200);

    await request(app.getHttpServer())
      .get("/settings")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .expect(403);
  });
});
