import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { PrismaService } from "../prisma/prisma.service";

describe("HealthController", () => {
  function buildController(queryRaw: () => Promise<unknown>) {
    const prisma = { $queryRaw: jest.fn(queryRaw) } as unknown as PrismaService;
    return new HealthController(prisma);
  }

  it("returns status ok when the database responds", async () => {
    const controller = buildController(() => Promise.resolve([{ "?column?": 1 }]));

    const report = await controller.check();

    expect(report.status).toBe("ok");
    expect(report.database).toBe("ok");
    expect(typeof report.uptimeSeconds).toBe("number");
    expect(typeof report.timestamp).toBe("string");
  });

  it("throws a 503 ServiceUnavailableException when the database is unreachable", async () => {
    const controller = buildController(() => Promise.reject(new Error("connection refused")));

    await expect(controller.check()).rejects.toThrow(ServiceUnavailableException);
  });

  it("liveness never checks the database and always returns ok", () => {
    const controller = buildController(() => Promise.reject(new Error("connection refused")));

    const report = controller.live();

    expect(report).toMatchObject({ status: "ok" });
    expect(typeof report.uptimeSeconds).toBe("number");
  });

  it("readiness mirrors check(): ok when the database responds", async () => {
    const controller = buildController(() => Promise.resolve([{ "?column?": 1 }]));

    const report = await controller.ready();

    expect(report).toMatchObject({ status: "ok", database: "ok" });
  });

  it("readiness throws a 503 when the database is unreachable", async () => {
    const controller = buildController(() => Promise.reject(new Error("connection refused")));

    await expect(controller.ready()).rejects.toThrow(ServiceUnavailableException);
  });
});
