import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadBrand(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, "");
    else vi.stubEnv(k, v);
  }
  return (await import("./brand")).brand;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("brand", () => {
  it("er TimeTrack i testmiljøet (vitest.config sætter NEXT_PUBLIC_BRAND)", async () => {
    const brand = await loadBrand({});
    expect(brand.id).toBe("timetrack");
    expect(brand.name).toBe("TimeTrack");
    expect(brand.legalOwner).toBe("Mahope");
    expect(brand.supportEmail).toBe("support@timetrack.dk");
    expect(brand.logo.icon).toBe("/icon.svg");
    expect(brand.logo.mailIcon).toBe(
      "https://timetrack.dk/brand/tt-ikon-64.png",
    );
    expect(brand.themeColor).toBe("#1E5B47");
    expect(brand.cloudUrl).toBe("https://timetrack.dk");
  });

  it("er TimeWren som standard, når NEXT_PUBLIC_BRAND mangler eller er tom", async () => {
    for (const value of ["", undefined]) {
      vi.resetModules();
      vi.stubEnv("NEXT_PUBLIC_BRAND", "");
      if (value === undefined) delete process.env.NEXT_PUBLIC_BRAND;
      const { brand } = await import("./brand");
      expect(brand.id).toBe("timewren");
      expect(brand.name).toBe("TimeWren");
      expect(brand.cloudUrl).toBeUndefined();
    }
  });

  it("falder tilbage til TimeWren ved ukendt værdi", async () => {
    const brand = await loadBrand({ NEXT_PUBLIC_BRAND: "andet" });
    expect(brand.id).toBe("timewren");
  });

  it("TimeWren har egne logofiler og ingen TimeTrack-stier", async () => {
    const brand = await loadBrand({
      NEXT_PUBLIC_BRAND: "timewren",
      NEXT_PUBLIC_APP_URL: "https://tid.example.org",
    });
    expect(brand.shortName).toBe("TimeWren");
    expect(brand.logo.icon).toBe("/brand/timewren/mark.svg");
    expect(brand.logo.wordmark).toBe("/brand/timewren/wordmark.svg");
    expect(brand.logo.faviconIco).toBe("/brand/timewren/favicon.ico");
    expect(brand.logo.faviconSvg).toBe("/brand/timewren/favicon.svg");
    expect(brand.themeColor).toBe("#3F5A3A");
    expect(brand.logo.mailIcon).toBe(
      "https://tid.example.org/brand/timewren/mark-64.png",
    );
    for (const path of Object.values(brand.logo)) {
      expect(path).not.toContain("timetrack");
    }
  });

  it("TimeWrens logofiler findes i public/", async () => {
    const brand = await loadBrand({ NEXT_PUBLIC_BRAND: "timewren" });
    const { mailIcon, ...local } = brand.logo;
    for (const path of [...Object.values(local), new URL(mailIcon).pathname]) {
      expect(existsSync(join(process.cwd(), "public", path)), path).toBe(true);
    }
  });

  it("serviceworkerens TimeWren-filer findes i public/", () => {
    const worker = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
    const paths = [...worker.matchAll(/"(\/brand\/timewren\/[^"\s]+)"/g)].map(
      (match) => match[1],
    );
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(existsSync(join(process.cwd(), "public", path)), path).toBe(true);
    }
  });

  it("contactEmail: TimeTrack beholder ejerens adresse, TimeWren følger supportEmail, env vinder", async () => {
    const tt = await loadBrand({ NEXT_PUBLIC_BRAND: "timetrack" });
    expect(tt.contactEmail).toBe("mads@timetrack.dk");
    const wren = await loadBrand({
      NEXT_PUBLIC_BRAND: "timewren",
      EMAIL_DOMAIN: "tid.example.org",
      SUPPORT_EMAIL: "",
      CONTACT_EMAIL: "",
    });
    expect(wren.contactEmail).toBe("support@tid.example.org");
    const fraEnv = await loadBrand({
      NEXT_PUBLIC_BRAND: "timewren",
      CONTACT_EMAIL: "anna@example.com",
    });
    expect(fraEnv.contactEmail).toBe("anna@example.com");
  });

  it("afleder supportEmail fra e-maildomænet på TimeWren, og env vinder", async () => {
    const afledt = await loadBrand({
      NEXT_PUBLIC_BRAND: "timewren",
      EMAIL_DOMAIN: "tid.example.org",
      SUPPORT_EMAIL: "",
    });
    expect(afledt.supportEmail).toBe("support@tid.example.org");
    const fraEnv = await loadBrand({
      NEXT_PUBLIC_BRAND: "timewren",
      SUPPORT_EMAIL: "hjaelp@example.org",
    });
    expect(fraEnv.supportEmail).toBe("hjaelp@example.org");
  });
});

describe("brand følger runtime-env (#1017)", () => {
  it("en frisk proces med andre env-værdier giver andet brand og URL uden rebuild", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://tid.example");
    const a = (await import("./brand")).brand;
    expect(a.id).toBe("timewren");
    expect(a.logo.mailIcon.startsWith("https://tid.example/")).toBe(true);

    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://andet.example");
    const b = (await import("./brand")).brand;
    expect(b.id).toBe("timetrack");
    expect(b.logo.mailIcon.startsWith("https://timetrack.dk/")).toBe(true);
    expect(b.cloudUrl).toBe("https://timetrack.dk");
  });

  it("marketing-guard og getMarketingUrl læser env ved kaldstidspunktet", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
    const guard = await import("./marketing-guard");
    const config = await import("./config");
    expect(guard.isMarketingEnabled()).toBe(false);
    expect(config.getMarketingUrl()).toBe("https://app.example");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://www.example");
    expect(guard.isMarketingEnabled()).toBe(true);
    expect(config.getMarketingUrl()).toBe("https://www.example");
  });
});
