import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./(instance)/instance-pages/robots.txt/route";
import robots from "./robots";

describe("robots", () => {
  function cloudRules() {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
    const { rules } = robots();
    return [rules].flat();
  }

  afterEach(() => vi.unstubAllEnvs());

  it("nævner AI-crawlerne eksplicit og tillader de offentlige sider", () => {
    const ai = cloudRules().find((r) => Array.isArray(r.userAgent));
    expect(ai?.userAgent).toEqual(
      expect.arrayContaining(["GPTBot", "ClaudeBot", "PerplexityBot"]),
    );
    expect(ai?.allow).toBe("/");
  });

  it("spærrer de private stier for alle regler", () => {
    for (const rule of cloudRules()) {
      expect(rule.disallow).toEqual(
        expect.arrayContaining(["/api/", "/dashboard/", "/portal/"]),
      );
    }
  });
});

describe("runtime robots.txt", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("blocks crawling when instance marketing is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "");
    expect(await GET().text()).toBe("User-agent: *\nDisallow: /\n");
  });

  it("advertises the running marketing URL when it is enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://my.example");
    expect(await GET().text()).toContain(
      "Sitemap: https://my.example/sitemap.xml",
    );
  });
});
