import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /dashboard/start (#startside) er login-landingssiden: slår brugerens
 * startside op og redirecter dertil. Mocker sessionsopslaget og
 * resolveStartPage (dækket separat af start-page.server.integration.test.ts)
 * for at teste selve rute-logikken — ingen session, ukendt bruger, og den
 * normale sti.
 */

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActiveOrgId: vi.fn(),
  findFirst: vi.fn(),
  resolveStartPage: vi.fn(),
  host: "",
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: mocks.host })),
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: mocks.resolveActiveOrgId,
}));
vi.mock("@/lib/db", () => ({
  db: { query: { users: { findFirst: mocks.findFirst } } },
}));
vi.mock("@/lib/start-page.server", () => ({
  resolveStartPage: mocks.resolveStartPage,
}));

const { GET } = await import("./route");

function request() {
  return GET(new Request("http://app.timetrack.dk/dashboard/start"));
}

describe("GET /dashboard/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.host = "";
    vi.unstubAllEnvs();
  });

  it("redirecter til /login uden session", async () => {
    mocks.getSession.mockResolvedValue(null);

    const res = await request();

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("redirecter til den opløste startside for en logget ind bruger", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u1" } });
    mocks.findFirst.mockResolvedValue({ startPage: "/dashboard/time" });
    mocks.resolveActiveOrgId.mockResolvedValue("org-1");
    mocks.resolveStartPage.mockResolvedValue("/dashboard/time");

    const res = await request();

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe(
      "/dashboard/time",
    );
    expect(mocks.resolveStartPage).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      "org-1",
      "/dashboard/time",
    );
  });

  it("redirecter til den offentlige app-adresse, ikke containerens interne host", async () => {
    // Bag proxyen kommer requesten ind som http://0.0.0.0:3000/... (prod 25/10).
    process.env.NEXT_PUBLIC_APP_URL = "https://app.timetrack.dk";
    mocks.getSession.mockResolvedValue({ user: { id: "u3" } });
    mocks.findFirst.mockResolvedValue({ startPage: "/dashboard/tasks" });
    mocks.resolveActiveOrgId.mockResolvedValue("org-1");
    mocks.resolveStartPage.mockResolvedValue("/dashboard/tasks");

    const res = await GET(new Request("http://0.0.0.0:3000/dashboard/start"));
    expect(res.headers.get("location")).toBe(
      "https://app.timetrack.dk/dashboard/tasks",
    );

    mocks.getSession.mockResolvedValue(null);
    const anon = await GET(new Request("http://0.0.0.0:3000/dashboard/start"));
    expect(anon.headers.get("location")).toBe("https://app.timetrack.dk/login");
  });

  it("falder tilbage til /dashboard når resolveStartPage gør det (ukendt/utilgængelig værdi)", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "u2" } });
    mocks.findFirst.mockResolvedValue({ startPage: null });
    mocks.resolveActiveOrgId.mockResolvedValue(null);
    mocks.resolveStartPage.mockResolvedValue("/dashboard");

    const res = await request();

    expect(new URL(res.headers.get("location") ?? "").pathname).toBe(
      "/dashboard",
    );
  });

  it("TimeWren-hosts redirecter til deres egen host, ikke TimeTracks app-URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    vi.stubEnv("TIMEWREN_APP_ENABLED", "1");
    vi.stubEnv(
      "BRANDS_CONFIG",
      JSON.stringify({
        timewren: { hosts: ["timewren.com", "www.timewren.com"] },
      }),
    );
    mocks.getSession.mockResolvedValue({ user: { id: "u4" } });
    mocks.findFirst.mockResolvedValue({ startPage: null });
    mocks.resolveActiveOrgId.mockResolvedValue("org-1");
    mocks.resolveStartPage.mockResolvedValue("/dashboard");

    mocks.host = "timewren.com";
    const tw = await GET(new Request("http://0.0.0.0:3000/dashboard/start"));
    expect(tw.headers.get("location")).toBe("https://timewren.com/dashboard");

    mocks.getSession.mockResolvedValue(null);
    const anon = await GET(new Request("http://0.0.0.0:3000/dashboard/start"));
    expect(anon.headers.get("location")).toBe("https://timewren.com/login");

    // timetrack-hosts som før.
    mocks.getSession.mockResolvedValue({ user: { id: "u4" } });
    mocks.host = "app.timetrack.dk";
    const tt = await GET(new Request("http://0.0.0.0:3000/dashboard/start"));
    expect(tt.headers.get("location")).toBe(
      "https://app.timetrack.dk/dashboard",
    );

    // Uden TIMEWREN_APP_ENABLED: som før, også på timewren.com.
    vi.stubEnv("TIMEWREN_APP_ENABLED", "");
    mocks.host = "timewren.com";
    const off = await GET(new Request("http://0.0.0.0:3000/dashboard/start"));
    expect(off.headers.get("location")).toBe(
      "https://app.timetrack.dk/dashboard",
    );
  });
});
