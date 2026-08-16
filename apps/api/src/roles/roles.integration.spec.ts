import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";
import { PasswordService } from "../auth/password.service";

// Phase 7.2 : GET /roles alimente le sélecteur de rôle du formulaire
// d'invitation côté frontend.
describe("RolesController — GET /roles (integration)", () => {
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
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await app.close();
  });

  async function permission(key: string) {
    return prisma.permission.upsert({ where: { key }, create: { key }, update: {} });
  }

  it("lists the enterprise's roles for a caller with users.manage", async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: `Roles Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const adminRole = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "ADMIN" } });
    await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "LECTEUR" } });
    const perm = await permission("users.manage");
    await prisma.rolePermission.create({ data: { roleId: adminRole.id, permissionId: perm.id } });

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
    await prisma.userRole.create({ data: { userId: admin.id, roleId: adminRole.id } });

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: admin.email, password })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .expect(200);

    expect(res.body.map((r: { name: string }) => r.name).sort()).toEqual(["ADMIN", "LECTEUR"]);
  });

  it("rejects without users.manage (403)", async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: `Roles Test 2 ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);
    const readerRole = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "LECTEUR" } });

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
    await prisma.userRole.create({ data: { userId: reader.id, roleId: readerRole.id } });

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: reader.email, password })
      .expect(200);

    await request(app.getHttpServer())
      .get("/roles")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .expect(403);
  });
});
