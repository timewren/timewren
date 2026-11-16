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
