import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "./password.service";

// Test 5 du plan (docs/PROMPT-MAITRE-SAAS.md §E) : un ADMIN d'entreprise ne
// peut jamais obtenir SUPER_ADMIN par une requête API. Deux couches
// indépendantes sont vérifiées ici : (1) aucun DTO exposé n'accepte un champ
// isSuperAdmin — Zod l'ignore silencieusement s'il est envoyé quand même ;
// (2) même en écriture directe, la contrainte CHECK posée en Phase 1
// (docs/adr/0004-modele-identite.md) empêche un état incohérent.
describe("Super Admin privilege escalation defenses (integration)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwordService: PasswordService;

  const createdEnterpriseIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    passwordService = app.get(PasswordService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.role.deleteMany({ where: { enterpriseId: { in: createdEnterpriseIds } } });
    await prisma.enterprise.deleteMany({ where: { id: { in: createdEnterpriseIds } } });
    await app.close();
  });

  it("ignores an isSuperAdmin field injected into the invitation body — the invited user is never a Super Admin", async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: `Escalation Test ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const role = await prisma.role.create({ data: { enterpriseId: enterprise.id, name: "ADMIN_ESCALATION" } });
    const permission = await prisma.permission.upsert({
      where: { key: "users.manage" },
      create: { key: "users.manage" },
      update: {},
    });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });

    const password = "AdminPassword9!";
    const admin = await prisma.user.create({
      data: {
        email: `admin-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash(password),
        firstName: "Admin",
        lastName: "Escalation",
        enterpriseId: enterprise.id,
        status: "ACTIVE",
      },
    });
    await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: admin.email, password })
      .expect(200);

    const inviteeEmail = `escalated-${randomUUID()}@test.local`;

    // isSuperAdmin n'existe pas dans inviteUserSchema : Zod le retire
    // silencieusement (mode "strip" par défaut) avant même d'atteindre le service.
    await request(app.getHttpServer())
      .post("/users/invite")
      .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
      .send({
        email: inviteeEmail,
        firstName: "Would-be",
        lastName: "SuperAdmin",
        roleId: role.id,
        isSuperAdmin: true,
      })
      .expect(201);

    const invitee = await prisma.user.findUniqueOrThrow({ where: { email: inviteeEmail } });
    expect(invitee.isSuperAdmin).toBe(false);
    expect(invitee.enterpriseId).toBe(enterprise.id);
  });

  it("rejects at the database level any row claiming isSuperAdmin with a non-null enterpriseId", async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: `Escalation Test 2 ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    await expect(
      prisma.user.create({
        data: {
          email: `forged-${randomUUID()}@test.local`,
          passwordHash: await passwordService.hash("Whatever9!"),
          firstName: "Forged",
          lastName: "SuperAdmin",
          enterpriseId: enterprise.id,
          isSuperAdmin: true,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects at the database level a Super Admin row (isSuperAdmin=true) that also carries an enterpriseId via update", async () => {
    const enterprise = await prisma.enterprise.create({ data: { name: `Escalation Test 3 ${randomUUID()}` } });
    createdEnterpriseIds.push(enterprise.id);

    const user = await prisma.user.create({
      data: {
        email: `normal-${randomUUID()}@test.local`,
        passwordHash: await passwordService.hash("Whatever9!"),
        firstName: "Normal",
        lastName: "User",
        enterpriseId: enterprise.id,
      },
    });

    // Même une tentative de "promotion sur place" (garder enterpriseId et
    // passer isSuperAdmin à true) est bloquée par la contrainte CHECK.
    await expect(prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: true } })).rejects.toThrow();
  });
});
