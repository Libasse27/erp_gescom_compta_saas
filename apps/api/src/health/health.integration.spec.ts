import { INestApplication, RequestMethod } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";

// Phase 10.5 / P-06 : /health, /health/live et /health/ready doivent
// répondre en dehors du préfixe /v1 (sonde d'infra indépendante du
// versionnage de l'API — voir main.ts). /health et /health/ready vérifient
// une vraie connectivité Postgres ; /health/live ne dépend d'aucun service
// externe (liveness pure).
describe("HealthController — GET /health, /health/live, /health/ready (integration)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1", {
      exclude: [
        { path: "health", method: RequestMethod.GET },
        { path: "health/live", method: RequestMethod.GET },
        { path: "health/ready", method: RequestMethod.GET },
      ],
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health responds 200 with a real database check, outside the /v1 prefix", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);

    expect(res.body).toMatchObject({ status: "ok", database: "ok" });
    expect(typeof res.body.uptimeSeconds).toBe("number");
  });

  it("GET /health/ready mirrors /health", async () => {
    const res = await request(app.getHttpServer()).get("/health/ready").expect(200);

    expect(res.body).toMatchObject({ status: "ok", database: "ok" });
  });

  it("GET /health/live responds 200 without a database field", async () => {
    const res = await request(app.getHttpServer()).get("/health/live").expect(200);

    expect(res.body).toMatchObject({ status: "ok" });
    expect(res.body.database).toBeUndefined();
  });

  it("none of the three routes are reachable under the /v1 prefix", async () => {
    await request(app.getHttpServer()).get("/v1/health").expect(404);
    await request(app.getHttpServer()).get("/v1/health/live").expect(404);
    await request(app.getHttpServer()).get("/v1/health/ready").expect(404);
  });
});
