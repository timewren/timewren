import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBrandConfigs,
  getBrandConfigsSafe,
  isMultibrandEnabled,
  pickLocale,
  resolveBrandByHost,
  splitLocalePrefix,
} from "./registry";

afterEach(() => vi.unstubAllEnvs());

describe("brand-register", () => {
  it("flaget er slået fra som standard", () => {
    expect(isMultibrandEnabled()).toBe(false);
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    expect(isMultibrandEnabled()).toBe(true);
  });

  it("timetrack-hosts giver timetrack, timewren-hosts giver timewren", () => {
    expect(resolveBrandByHost("timetrack.dk").key).toBe("timetrack");
    expect(resolveBrandByHost("app.timetrack.dk:443").key).toBe("timetrack");
    expect(resolveBrandByHost("TimeWren.com").key).toBe("timewren");
    expect(resolveBrandByHost("app.timewren.com").key).toBe("timewren");
  });

  it("ukendt host og tom host giver timetrack", () => {
    expect(resolveBrandByHost("localhost:3000").key).toBe("timetrack");
    expect(resolveBrandByHost(null).key).toBe("timetrack");
    expect(resolveBrandByHost("evil.example").key).toBe("timetrack");
  });

  it("BRANDS_CONFIG overstyrer hosts og farver; ødelagt JSON fejler lukket", () => {
    const c = getBrandConfigs(
      JSON.stringify({
        timewren: { hosts: ["timewren.io"], colors: { primary: "#000000" } },
      }),
    );
    expect(resolveBrandByHost("timewren.io", c).key).toBe("timewren");
    expect(resolveBrandByHost("timewren.com", c).key).toBe("timetrack");
    expect(c.timewren.colors.primary).toBe("#000000");
    expect(c.timewren.colors.primaryDark).toBe("#2F442B");
    expect(() => getBrandConfigs("{nope")).toThrow();
  });

  it("sprogvalg: cookie > Accept-Language > standard, kun brandets sprog", () => {
    const tw = resolveBrandByHost("timewren.com");
    const tt = resolveBrandByHost("timetrack.dk");
    expect(pickLocale(tw, { cookie: "de" })).toBe("de");
    expect(pickLocale(tw, { acceptLanguage: "es-ES,es;q=0.9" })).toBe("es");
    expect(pickLocale(tw, { acceptLanguage: "fr-FR" })).toBe("en");
    expect(pickLocale(tw, { cookie: "fr" })).toBe("en");
    expect(pickLocale(tt, { cookie: "de", acceptLanguage: "en" })).toBe("da");
  });

  it("sti-præfiks kun for brandets sprog", () => {
    const tw = resolveBrandByHost("timewren.com");
    expect(splitLocalePrefix(tw, "/de/pricing")).toEqual({
      locale: "de",
      rest: "/pricing",
    });
    expect(splitLocalePrefix(tw, "/de")).toEqual({ locale: "de", rest: "/" });
    expect(splitLocalePrefix(tw, "/dashboard").locale).toBeNull();
    expect(
      splitLocalePrefix(resolveBrandByHost("timetrack.dk"), "/de/x").locale,
    ).toBeNull();
  });
});

describe("BRANDS_CONFIG-validering og sikker indlæsning", () => {
  it("afviser tomme hosts og ugyldige locales", () => {
    expect(() =>
      getBrandConfigs(JSON.stringify({ timewren: { hosts: [] } })),
    ).toThrow(/hosts/);
    expect(() =>
      getBrandConfigs(JSON.stringify({ timewren: { locales: ["xx"] } })),
    ).toThrow(/locales/);
    expect(() =>
      getBrandConfigs(JSON.stringify({ timewren: { defaultLocale: "xx" } })),
    ).toThrow(/defaultLocale/);
  });

  it("getBrandConfigsSafe: ødelagt konfiguration giver standarder, ikke 500", () => {
    const old = process.env.BRANDS_CONFIG;
    process.env.BRANDS_CONFIG = "{ikke json";
    try {
      const cfg = getBrandConfigsSafe();
      expect(resolveBrandByHost("timetrack.dk", cfg).key).toBe("timetrack");
      expect(resolveBrandByHost("timetrack.dk").key).toBe("timetrack");
    } finally {
      if (old === undefined) delete process.env.BRANDS_CONFIG;
      else process.env.BRANDS_CONFIG = old;
    }
  });
});
