/**
 * Servertekster følger hostens brand (TimeWren Cloud): tRPC-kald på en
 * TimeWren-host, getT/getClientMessages i en forespørgsel dertil og
 * /runtime-config.js, der fortæller browseren hostens brand. Uden multibrand
 * og på timetrack-hosts er alt som før (build-brandet, testmiljøets er
 * timetrack).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as runtimeConfig } from "@/app/runtime-config.js/route";
import { currentBrandId } from "@/i18n/brandize";
import { runWithBrand, textBrandFromHeaders, tr } from "@/i18n/server-text";
import { syncT } from "@/i18n/sync-text";

const mocks = vi.hoisted(() => ({ host: "timetrack.dk" }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ host: mocks.host })),
}));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "da") }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  mocks.host = "timetrack.dk";
});

const hostHeaders = (host: string) => new Headers({ host });

describe("textBrandFromHeaders", () => {
  it("giver timewren for en TimeWren-host med multibrand", () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    expect(textBrandFromHeaders(hostHeaders("timewren.com"))).toBe("timewren");
  });

  it("giver intet for timetrack-hosts, ukendte hosts og uden flaget", () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    expect(textBrandFromHeaders(hostHeaders("timetrack.dk"))).toBeUndefined();
    expect(textBrandFromHeaders(hostHeaders("localhost:3000"))).toBeUndefined();
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    expect(textBrandFromHeaders(hostHeaders("timewren.com"))).toBeUndefined();
  });
});

describe("tekster i et kald med brand (tRPC)", () => {
  it("syncT og tr siger TimeWren i et TimeWren-kald og TimeTrack udenfor", async () => {
    expect(syncT("friendly.server")).toContain("TimeTrack");
    await runWithBrand("timewren", async () => {
      expect(currentBrandId()).toBe("timewren");
      expect(syncT("friendly.server")).toContain("TimeWren");
      expect(syncT("friendly.server")).not.toContain("TimeTrack");
      const title = await tr("serverExports", "readme.orgTitle");
      expect(title).toContain("TimeWren");
    });
    expect(currentBrandId()).toBe("timetrack");
    expect(await tr("serverExports", "readme.orgTitle")).toContain("TimeTrack");
  });

  it("runWithBrand uden brand ændrer intet", () => {
    runWithBrand(undefined, () => {
      expect(currentBrandId()).toBe("timetrack");
    });
  });
});

/** Eksportens titel via getT (løst typet nøgle). */
async function orgTitle(locale?: string): Promise<string> {
  const { getT } = await import("@/i18n/server");
  const t = (await getT("serverExports", locale)) as unknown as (
    key: string,
  ) => string;
  return t("readme.orgTitle");
}

describe("getT og getClientMessages i en forespørgsel", () => {
  it("følger hosten med multibrand", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    mocks.host = "timewren.com";
    const { getClientMessages } = await import("@/i18n/server");
    expect(await orgTitle()).toContain("TimeWren");
    const msgs = (await getClientMessages("serverSync")) as {
      serverSync: { friendly: { server: string } };
    };
    expect(msgs.serverSync.friendly.server).toContain("TimeWren");
  });

  it("er uændret på timetrack-hosts og uden flaget", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    mocks.host = "timetrack.dk";
    expect(await orgTitle()).toContain("TimeTrack");
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    mocks.host = "timewren.com";
    expect(await orgTitle()).toContain("TimeTrack");
  });

  it("et udtrykkeligt sprog (mails, cron) læser ikke hosten", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    mocks.host = "timewren.com";
    expect(await orgTitle("da")).toContain("TimeTrack");
  });
});

describe("/runtime-config.js", () => {
  const body = async (host: string) =>
    runtimeConfig(
      new Request(`https://${host}/runtime-config.js`, {
        headers: { host },
      }),
    ).text();

  it("fortæller browseren hostens brand på en TimeWren-host", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    expect(await body("timewren.com")).toContain('"hostBrand":"timewren"');
  });

  it("er byte-identisk med før på timetrack-hosts og uden flaget", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    const before = await body("timetrack.dk");
    expect(before).not.toContain("hostBrand");
    expect(await body("timewren.com")).toBe(before);
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    expect(await body("timetrack.dk")).toBe(before);
  });

  it("browseren bruger hostBrand som standardbrand for tekster", () => {
    vi.stubGlobal("window", { __TT_CONFIG__: { hostBrand: "timewren" } });
    expect(currentBrandId()).toBe("timewren");
    vi.stubGlobal("window", { __TT_CONFIG__: { hostBrand: "andet" } });
    expect(currentBrandId()).toBe("timetrack");
  });
});
