import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createDemoAccount: vi.fn(),
  signInEmail: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/demo/create-demo-account", () => ({
  createDemoAccount: h.createDemoAccount,
}));
vi.mock("@/lib/auth", () => ({
  authForHost: () => ({ api: { signInEmail: h.signInEmail } }),
}));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));

import { rateLimiter } from "@/lib/utils/rate-limiter";
import { POST } from "./route";

const APP = "https://demo.example";
let ip = 0;

function start(opts: { ip?: string; origin?: string } = {}) {
  return POST(
    new Request(`${APP}/api/demo/start`, {
      method: "POST",
      headers: {
        "x-forwarded-for": opts.ip ?? `203.0.113.${++ip}`,
        host: "demo.example",
        origin: opts.origin ?? APP,
      },
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "1");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  h.createDemoAccount.mockResolvedValue({
    ok: true,
    userId: "u1",
    orgId: "o1",
    email: "demo-abc@demo.invalid",
    password: "hemmelig",
    counts: {},
  });
  h.signInEmail.mockResolvedValue({
    headers: new Headers([
      ["set-cookie", "better-auth.session_token=abc; Path=/; HttpOnly"],
    ]),
    response: {},
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/demo/start", () => {
  it("findes ikke uden DEMO_MODE (404) og opretter intet", async () => {
    vi.stubEnv("DEMO_MODE", "");
    const res = await start();
    expect(res.status).toBe(404);
    expect(h.createDemoAccount).not.toHaveBeenCalled();
  });

  it("opretter en demokonto, logger ind og sender til dashboardet", async () => {
    const res = await start();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${APP}/dashboard`);
    expect(res.headers.get("set-cookie")).toContain(
      "better-auth.session_token=abc",
    );
    expect(h.signInEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { email: "demo-abc@demo.invalid", password: "hemmelig" },
        returnHeaders: true,
      }),
    );
  });

  it("højst 10 konti i timen pr. IP; derefter en venlig besked", async () => {
    const same = "198.51.100.7";
    await rateLimiter.reset("ip:198.51.100.7:demo-start");
    for (let i = 0; i < 10; i++) {
      expect((await start({ ip: same })).headers.get("location")).toBe(
        `${APP}/dashboard`,
      );
    }
    const blocked = await start({ ip: same });
    expect(blocked.status).toBe(303);
    expect(blocked.headers.get("location")).toBe(
      `${APP}/login?demo=rate_limited`,
    );
    expect(h.createDemoAccount).toHaveBeenCalledTimes(10);
    // En anden IP er ikke ramt
    expect((await start()).headers.get("location")).toBe(`${APP}/dashboard`);
  });

  it("sender tilbage med ?demo=full, når loftet over demokonti er nået", async () => {
    h.createDemoAccount.mockResolvedValue({ ok: false, reason: "full" });
    const res = await start();
    expect(res.headers.get("location")).toBe(`${APP}/login?demo=full`);
    expect(h.signInEmail).not.toHaveBeenCalled();
  });

  it("afviser en formular fra et andet site (403)", async () => {
    const res = await start({ origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(h.createDemoAccount).not.toHaveBeenCalled();
  });

  it("en fejl giver ?demo=error i stedet for en 500", async () => {
    h.createDemoAccount.mockRejectedValue(new Error("db nede"));
    const res = await start();
    expect(res.headers.get("location")).toBe(`${APP}/login?demo=error`);
  });
});
