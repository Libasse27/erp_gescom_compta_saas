import { INestApplication, RequestMethod } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";

// Phase 10.5 : /health doit répondre en dehors du préfixe /v1 (sonde d'infra
// indépendante du versionnage de l'API — voir main.ts) et vérifier une vraie
// connectivité Postgres, pas juste répondre "200" inconditionnellement.
describe("HealthController — GET /health (integration)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1", {
      exclude: [{ path: "health", method: RequestMethod.GET }],
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("responds 200 with a real database check, outside the /v1 prefix", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);

    expect(res.body).toMatchObject({ status: "ok", database: "ok" });
    expect(typeof res.body.uptimeSeconds).toBe("number");
  });

  it("is not reachable under the /v1 prefix", async () => {
    await request(app.getHttpServer()).get("/v1/health").expect(404);
  });
});
