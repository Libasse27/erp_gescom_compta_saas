import { computeRateLimits } from "./rate-limit";

describe("computeRateLimits", () => {
  it("applies strict production-like limits when NODE_ENV is not 'test'", () => {
    const limits = computeRateLimits("production");
    expect(limits.global).toEqual({ ttl: 60_000, limit: 100 });
    expect(limits.auth).toEqual({ default: { limit: 10, ttl: 60_000 } });
  });

  it("relaxes limits under NODE_ENV=test so integration tests are not throttled", () => {
    const limits = computeRateLimits("test");
    expect(limits.global.limit).toBeGreaterThan(100);
    expect(limits.auth.default.limit).toBeGreaterThan(10);
  });
});
