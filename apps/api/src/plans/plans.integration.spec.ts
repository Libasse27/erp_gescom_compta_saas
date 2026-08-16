import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../app.module";
import { RawDbClient } from "../prisma/raw-db-client";

// Phase 7.1 : GET /plans public, nécessaire pour que l'inscription puisse
// afficher un choix de forfait réel (docs/SPECIFICATIONS-SAAS.md §7 étape 3).
describe("PlansController — GET /plans (integration)", () => {
  let app: INestApplication;
  let prisma: RawDbClient;

  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = new RawDbClient();
  });

  afterAll(async () => {
    await prisma.planLimit.deleteMany({ where: { planId: { in: createdPlanIds } } });
    await prisma.plan.deleteMany({ where: { id: { in: createdPlanIds } } });
    await app.close();
  });

  it("lists only active plans, ordered by sortOrder, without requiring authentication", async () => {
    const limit = await prisma.limit.upsert({
      where: { key: "users" },
      create: { key: "users", label: "Utilisateurs" },
      update: {},
    });

    const inactive = await prisma.plan.create({
      data: { code: `INACTIVE_${randomUUID()}`, name: "Inactive", priceMonthly: 1_000, isActive: false, sortOrder: 0 },
    });
    createdPlanIds.push(inactive.id);

    const second = await prisma.plan.create({
      data: {
        code: `SECOND_${randomUUID()}`,
        name: "Second",
        priceMonthly: 20_000,
        sortOrder: 2,
        planLimits: { create: { limitId: limit.id, value: 10 } },
      },
    });
    createdPlanIds.push(second.id);

    const first = await prisma.plan.create({
      data: { code: `FIRST_${randomUUID()}`, name: "First", priceMonthly: 10_000, sortOrder: 1 },
    });
    createdPlanIds.push(first.id);

    const res = await request(app.getHttpServer()).get("/plans").expect(200);

    const codes = res.body.map((p: { code: string }) => p.code);
    expect(codes).not.toContain(inactive.code);
    expect(codes.indexOf(first.code)).toBeLessThan(codes.indexOf(second.code));

    const secondEntry = res.body.find((p: { code: string }) => p.code === second.code);
    expect(secondEntry.maxUsers).toBe(10);
    const firstEntry = res.body.find((p: { code: string }) => p.code === first.code);
    expect(firstEntry.maxUsers).toBeNull();
  });
});
