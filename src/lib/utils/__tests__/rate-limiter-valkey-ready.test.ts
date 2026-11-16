import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// En falsk Valkey-klient, hvis status styres af testen.
const fake = {
  status: "connecting" as string,
  eval: vi.fn(async () => [1, 60_000]),
  del: vi.fn(async () => 1),
  get: vi.fn(async () => "1"),
  pttl: vi.fn(async () => 60_000),
};

vi.mock("@/lib/valkey", () => ({
  getValkey: () => fake,
  getReadyValkey: () => (fake.status === "ready" ? fake : null),
}));

const { rateLimiter } = await import("@/lib/utils/rate-limiter");

describe("rateLimiter med Valkey-backend", () => {
  const original = process.env.RATE_LIMIT_BACKEND;

  beforeEach(() => {
    process.env.RATE_LIMIT_BACKEND = "valkey";
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.RATE_LIMIT_BACKEND;
    else process.env.RATE_LIMIT_BACKEND = original;
  });

  it("bruger in-memory uden at kalde Valkey eller logge, før forbindelsen er klar", async () => {
    fake.status = "connecting";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const key = `test:${Math.random()}`;

    const r = await rateLimiter.check(key, "signup");
    await rateLimiter.getUsage(key, "signup");
    await rateLimiter.reset(key);

    expect(r.allowed).toBe(true);
    expect(fake.eval).not.toHaveBeenCalled();
    expect(fake.get).not.toHaveBeenCalled();
    expect(fake.del).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("bruger Valkey, når forbindelsen er klar", async () => {
    fake.status = "ready";
    const r = await rateLimiter.check(`test:${Math.random()}`, "signup");
    expect(fake.eval).toHaveBeenCalledTimes(1);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });
});
