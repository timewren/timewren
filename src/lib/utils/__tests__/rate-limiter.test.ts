import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RateLimitError, rateLimiter } from "@/lib/utils/rate-limiter";

// These tests run with RATE_LIMIT_BACKEND unset → in-memory backend.
describe("rateLimiter (in-memory fallback)", () => {
  const original = process.env.RATE_LIMIT_BACKEND;

  beforeEach(() => {
    delete process.env.RATE_LIMIT_BACKEND;
  });

  afterEach(async () => {
    if (original === undefined) delete process.env.RATE_LIMIT_BACKEND;
    else process.env.RATE_LIMIT_BACKEND = original;
  });

  it("allows up to the configured limit then blocks", async () => {
    const key = `test:${Math.random()}`;
    // signup config = 3 per hour
    for (let i = 0; i < 3; i++) {
      const r = await rateLimiter.check(key, "signup");
      expect(r.allowed).toBe(true);
    }
    const blocked = await rateLimiter.check(key, "signup");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("checkOrThrow throws RateLimitError when exceeded", async () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) await rateLimiter.checkOrThrow(key, "signup");
    await expect(
      rateLimiter.checkOrThrow(key, "signup"),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("reset clears the counter", async () => {
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) await rateLimiter.check(key, "signup");
    await rateLimiter.reset(key);
    const r = await rateLimiter.check(key, "signup");
    expect(r.allowed).toBe(true);
  });
});
