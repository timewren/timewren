import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

function request(url: string) {
  return new NextRequest(url, { headers: { host: new URL(url).host } });
}

describe("middleware: app-host og søgemaskiner", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://timetrack.dk");
    vi.stubEnv("SUBDOMAIN_REDIRECT_STATUS", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("tillader crawl af app-hosten, men beder om noindex", async () => {
    const res = middleware(request("https://app.timetrack.dk/robots.txt"));
    expect(await res.text()).toBe("User-agent: *\nAllow: /\n");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("sætter noindex på app-sider", () => {
    const res = middleware(request("https://app.timetrack.dk/dashboard"));
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("redirecter marketing-stier permanent fra app-hosten", () => {
    const res = middleware(request("https://app.timetrack.dk/online-stopur"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(
      "https://timetrack.dk/online-stopur",
    );
  });

  it("kan sættes tilbage til midlertidige redirects", () => {
    vi.stubEnv("SUBDOMAIN_REDIRECT_STATUS", "307");
    const res = middleware(request("https://app.timetrack.dk/online-stopur"));
    expect(res.status).toBe(307);
  });

  it("serverer offline-siden fra app-hosten, så service workeren kan precache den", () => {
    const res = middleware(request("https://app.timetrack.dk/offline"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("sætter ikke noindex på marketing-hosten", () => {
    const res = middleware(request("https://timetrack.dk/online-stopur"));
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });
});

describe("middleware: offentlig demo (DEMO_MODE=1)", () => {
  beforeEach(() => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://demo.timewren.com");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("spærrer alt i robots.txt", async () => {
    const res = middleware(request("https://demo.timewren.com/robots.txt"));
    expect(await res.text()).toBe("User-agent: *\nDisallow: /\n");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("sætter noindex på alle sider", () => {
    for (const path of ["/login", "/dashboard", "/"]) {
      const res = middleware(request(`https://demo.timewren.com${path}`));
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
    }
  });

  it("sender signup til login-siden med demo-knappen", () => {
    const res = middleware(request("https://demo.timewren.com/register"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://demo.timewren.com/login");
  });

  it("uden DEMO_MODE er robots.txt og signup uændret", () => {
    vi.stubEnv("DEMO_MODE", "");
    const robots = middleware(request("https://demo.timewren.com/robots.txt"));
    expect(robots.headers.get("x-robots-tag")).toBeNull();
    const signup = middleware(request("https://demo.timewren.com/register"));
    expect(signup.headers.get("location")).toBeNull();
  });
});

describe("middleware: Cloud data processing agreement PDF", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["", "https://instance.example"])(
    "blocks the Cloud PDF on a self-hosted instance with marketing URL %s",
    (marketingUrl) => {
      vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://instance.example");
      vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", marketingUrl);
      const res = middleware(
        request("https://instance.example/databehandleraftale/pdf"),
      );
      expect(res.status).toBe(404);
    },
  );

  it("keeps the public PDF route on Cloud when the runtime URL changes", () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://timetrack.dk");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://timetrack.dk");
    const res = middleware(
      request("https://timetrack.dk/databehandleraftale/pdf"),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
