import { NextRequest } from "next/server";
import { prerenderToNodeStream } from "react-dom/static";
import { afterEach, describe, expect, it, vi } from "vitest";

// Forsiden, prissiden og de juridiske sider på timetrack.dk. Snapshots er
// taget på basen (release/open-source-samlet) FØR TimeWren-landingpagen, de
// juridiske før TimeWrens egne. Går de i rødt, er TimeTracks marketing ændret.

vi.mock("@/app/globals.css", () => ({}));
// Navigation, Footer og cookie-banneret oversættes på serveren. Uden
// RSC-miljø i vitest gives getTranslations her de rigtige danske kataloger.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const { loadMessages } = await import("@/i18n/messages/load");
  const { brandize } = await import("@/i18n/brandize");
  return {
    getTranslations: async (
      opts: string | { locale: string; namespace: string },
    ) => {
      const { locale, namespace } =
        typeof opts === "string" ? { locale: "da", namespace: opts } : opts;
      const messages = brandize(await loadMessages(locale as "da"));
      return createTranslator({ locale, messages, namespace } as never);
    },
  };
});
vi.mock("next/font/google", () => ({
  Geist_Mono: () => ({ variable: "mono" }),
  Schibsted_Grotesk: () => ({ variable: "sans" }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));

vi.mock("@/content/testimonials", async () => {
  const { FIXTURE_TESTIMONIALS } = await import(
    "@/content/testimonials.fixture"
  );
  return {
    TESTIMONIALS: FIXTURE_TESTIMONIALS,
    approvedTestimonials: () => FIXTURE_TESTIMONIALS,
  };
});
afterEach(() => vi.unstubAllEnvs());

function req(url: string) {
  return new NextRequest(url, { headers: { host: new URL(url).host } });
}

async function renderPage(mod: { default: () => unknown }) {
  const el = await mod.default();
  // Navigation og Footer er async serverkomponenter (oversat på serveren);
  // prerender venter på dem. Suspense-markørerne fjernes, så HTML'en kan
  // sammenlignes med snapshottet fra før oversættelsen.
  const { prelude } = await prerenderToNodeStream(el as React.ReactElement);
  let html = "";
  for await (const chunk of prelude) html += chunk;
  return html.replace(/<!--\/?\$-->/g, "").replace(/<!-- -->/g, "");
}

describe("timetrack.dk: forside og prisside er uændrede", () => {
  it("forsiden: metadata og HTML", async () => {
    const mod = await import("@/app/(marketing)/page");
    expect(JSON.stringify(mod.metadata, null, 1)).toMatchSnapshot("metadata");
    expect(await renderPage(mod)).toMatchSnapshot("html");
  });

  it("shows monthly norms and holidays on the hours calculator", async () => {
    const mod = await import("@/app/(marketing)/arbejdstimer-beregner/page");
    const html = await renderPage(mod);
    expect(html).toContain("2026 i alt");
    expect(html).toContain("2027 i alt");
    expect(html).toContain("Timer ved 30 t/uge");
    expect(html).toContain("Kristi himmelfartsdag");
    for (const prompt of ["Prøv timeren i TimeTrack", 'name="website"']) {
      expect(html.indexOf("2027 i alt")).toBeLessThan(html.indexOf(prompt));
    }
  });

  it("prissiden: metadata og HTML", async () => {
    const mod = await import("@/app/(marketing)/pricing/page");
    expect(JSON.stringify(mod.metadata, null, 1)).toMatchSnapshot("metadata");
    expect(await renderPage(mod)).toMatchSnapshot("html");
  });

  // Juridiske sider: TimeWren har sine egne tekster, timetrack.dk's må ikke
  // ændre sig (snapshots taget før TimeWrens juridiske sider).
  it.each([
    ["privatlivspolitikken", "privacy"],
    ["vilkårene", "terms"],
    ["databehandleraftalen", "databehandleraftale"],
  ])("%s: metadata og HTML", async (_name, route) => {
    const mod = await import(`@/app/(marketing)/${route}/page.tsx`);
    expect(JSON.stringify(mod.metadata, null, 1)).toMatchSnapshot("metadata");
    expect(await renderPage(mod)).toMatchSnapshot("html");
  });

  it.each([
    "/",
    "/pricing",
    "/da",
    "/da/pricing",
    "/self-hosting",
    "/robots.txt",
  ])(
    "middleware %s på timetrack.dk: samme svar med og uden flaget",
    async (path) => {
      vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
      vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://timetrack.dk");
      const { middleware } = await import("@/middleware");
      const snap = (r: Response) => ({
        status: r.status,
        location: r.headers.get("location"),
        robots: r.headers.get("x-robots-tag"),
        rewrite: r.headers.get("x-middleware-rewrite"),
      });
      for (const host of ["timetrack.dk", "app.timetrack.dk"]) {
        vi.stubEnv("MULTIBRAND_ENABLED", "");
        const off = snap(middleware(req(`https://${host}${path}`)));
        vi.stubEnv("MULTIBRAND_ENABLED", "1");
        vi.stubEnv("TIMEWREN_INDEXABLE", "1");
        const on = snap(middleware(req(`https://${host}${path}`)));
        vi.stubEnv("TIMEWREN_INDEXABLE", "");
        expect(on).toEqual(off);
        expect(off).toMatchSnapshot(host);
      }
    },
  );
});
