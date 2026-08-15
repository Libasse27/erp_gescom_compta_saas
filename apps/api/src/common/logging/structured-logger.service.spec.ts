import { StructuredLoggerService } from "./structured-logger.service";
import { RequestContext } from "./request-context";
import { TenantContext } from "../../tenant/tenant-context";

describe("StructuredLoggerService", () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let logger: StructuredLoggerService;
  const originalLogLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    logger = new StructuredLoggerService();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.env.LOG_LEVEL = originalLogLevel;
  });

  function lastLogLine(): Record<string, unknown> {
    expect(logSpy).toHaveBeenCalledTimes(1);
    return JSON.parse(logSpy.mock.calls[0][0] as string);
  }

  it("writes a JSON line with timestamp, level and message, and no correlation fields outside any context", () => {
    logger.log("hello");

    const entry = lastLogLine();
    expect(entry.level).toBe("log");
    expect(entry.message).toBe("hello");
    expect(typeof entry.timestamp).toBe("string");
    expect(entry.requestId).toBeUndefined();
    expect(entry.tenantId).toBeUndefined();
  });

  it("correlates with the active requestId (RequestContext) without any tenant context", () => {
    RequestContext.run({ requestId: "req-123" }, () => logger.log("hello"));

    const entry = lastLogLine();
    expect(entry.requestId).toBe("req-123");
    expect(entry.tenantId).toBeUndefined();
  });

  it("correlates with both requestId and tenantId/userId when both contexts are active", () => {
    RequestContext.run({ requestId: "req-123" }, () =>
      TenantContext.run({ tenantId: "tenant-A", userId: "user-1", isSuperAdmin: false }, () =>
        logger.log("hello"),
      ),
    );

    const entry = lastLogLine();
    expect(entry.requestId).toBe("req-123");
    expect(entry.tenantId).toBe("tenant-A");
    expect(entry.userId).toBe("user-1");
  });

  it("routes error()/fatal() to console.error, not console.log", () => {
    logger.error("boom");

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("boom");
  });

  it("extracts trace and context from error(message, trace, context) (Nest's convention)", () => {
    logger.error("boom", "Error: boom\n    at somewhere", "MyService");

    const entry = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(entry.stack).toBe("Error: boom\n    at somewhere");
    expect(entry.context).toBe("MyService");
  });

  it("extracts context from log(message, context)", () => {
    logger.log("hello", "MyService");

    const entry = lastLogLine();
    expect(entry.context).toBe("MyService");
  });

  it("respects LOG_LEVEL: filters out lower-priority levels", () => {
    process.env.LOG_LEVEL = "error";

    logger.debug("debug msg");
    logger.log("log msg");
    logger.warn("warn msg");
    expect(logSpy).not.toHaveBeenCalled();

    logger.error("error msg");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("logHttpRequest() emits structured fields and picks the level from statusCode", () => {
    logger.logHttpRequest({ method: "GET", path: "/v1/customers", statusCode: 200, durationMs: 12.3456 });

    const entry = lastLogLine();
    expect(entry).toMatchObject({
      level: "log",
      context: "HTTP",
      method: "GET",
      path: "/v1/customers",
      statusCode: 200,
    });
    expect(entry.message).toContain("GET /v1/customers 200");
  });

  it("logHttpRequest() with a 4xx status still writes to console.log (warn), not console.error", () => {
    logger.logHttpRequest({ method: "GET", path: "/v1/customers/x", statusCode: 404, durationMs: 1 });

    expect(errorSpy).not.toHaveBeenCalled();
    const entry = lastLogLine();
    expect(entry.level).toBe("warn");
  });

  it("logHttpRequest() with a 5xx status writes to console.error", () => {
    logger.logHttpRequest({ method: "GET", path: "/v1/customers", statusCode: 500, durationMs: 1 });

    expect(logSpy).not.toHaveBeenCalled();
    const entry = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(entry.level).toBe("error");
  });
});
