import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Falsk Valkey-klient; status og tæller styres af testen.
const fake = {
  status: "connecting" as string,
  eval: vi.fn(async () => [1, 60_000]),
};

vi.mock("@/lib/valkey", () => ({
  getValkey: () => fake,
  getReadyValkey: () => (fake.status === "ready" ? fake : null),
}));

const { checkRateLimit, getClientIp } = await import(
  "@/lib/desktop-rate-limit"
);

function req(headers: Record<string, string>) {
  return new Request("https://example.com/api/desktop/analytics", {
    headers,
  });
}

describe("getClientIp (desktop/extension)", () => {
  it("bruger det yderste højre X-Forwarded-For-hop, ikke klientens egen værdi", () => {
    expect(
      getClientIp(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" })),
    ).toBe("203.0.113.7");
  });

  it("en forfalsket venstre værdi giver ikke en ny tæller", () => {
    const a = getClientIp(req({ "x-forwarded-for": "9.9.9.1, 203.0.113.7" }));
    const b = getClientIp(req({ "x-forwarded-for": "9.9.9.2, 203.0.113.7" }));
    expect(a).toBe(b);
  });

  it("falder tilbage til x-real-ip og ellers 'unknown'", () => {
    expect(getClientIp(req({ "x-real-ip": "198.51.100.1" }))).toBe(
      "198.51.100.1",
    );
    expect(getClientIp(req({}))).toBe("unknown");
  });
});

describe("checkRateLimit (desktop/extension)", () => {
  const original = process.env.RATE_LIMIT_BACKEND;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.RATE_LIMIT_BACKEND;
    else process.env.RATE_LIMIT_BACKEND = original;
  });

  it("in-memory: tillader op til grænsen og blokerer derefter", async () => {
    delete process.env.RATE_LIMIT_BACKEND;
    const key = `test:${Math.random()}`;
    for (let i = 0; i < 3; i++) {
      expect(await checkRateLimit(key, 3, 60_000)).toBe(true);
    }
    expect(await checkRateLimit(key, 3, 60_000)).toBe(false);
  });

  it("tæller i Valkey (delt på tværs af replicas), når backenden er valgt", async () => {
    process.env.RATE_LIMIT_BACKEND = "valkey";
    fake.status = "ready";
    fake.eval.mockResolvedValueOnce([4, 30_000]);
    expect(await checkRateLimit(`test:${Math.random()}`, 3, 60_000)).toBe(
      false,
    );
    expect(fake.eval).toHaveBeenCalledTimes(1);
    expect(fake.eval.mock.calls[0]).toContain("60000");
  });
});
