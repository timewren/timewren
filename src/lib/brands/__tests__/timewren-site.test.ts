import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";
import { getBrandConfigs } from "../registry";
import { routeSite, sitePath } from "../timewren-site";

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    headers: { host: new URL(url).host, ...headers },
  });
}

const snap = (r: Response) => ({
  status: r.status,
  location: r.headers.get("location"),
  robots: r.headers.get("x-robots-tag"),
  rewrite: r.headers.get("x-middleware-rewrite"),
  locale: r.headers.get("x-middleware-request-x-brand-locale"),
});

beforeEach(() => {
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
  vi.stubEnv("BRANDS_CONFIG", "");
  vi.stubEnv("TIMEWREN_APP_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("TimeWren-app spærret uden TIMEWREN_APP_ENABLED", () => {
  it.each(["/login", "/register", "/dashboard", "/da/login"])(
    "timewren.com%s giver 404 og noindex",
    (path) => {
      vi.stubEnv("TIMEWREN_APP_ENABLED", "");
      const r = snap(middleware(req(`https://timewren.com${path}`)));
      expect(r.rewrite).toBe("https://timewren.com/_marketing-disabled");
      expect(r.robots).toBe("noindex, nofollow");
    },
  );

  it("marketingsiderne svarer stadig", () => {
    vi.stubEnv("TIMEWREN_APP_ENABLED", "");
    const r = snap(middleware(req("https://timewren.com/pricing")));
    expect(r.rewrite).toBe("https://timewren.com/timewren-site/en/pricing");
  });

  it("timetrack.dk's app er uberørt", () => {
    vi.stubEnv("TIMEWREN_APP_ENABLED", "");
    const r = snap(middleware(req("https://app.timetrack.dk/dashboard")));
    expect(r.rewrite).not.toBe("https://app.timetrack.dk/_marketing-disabled");
  });
});

it("rewrites the public TimeWren account deletion page without a session", () => {
  vi.stubEnv("TIMEWREN_APP_ENABLED", "");
  const r = snap(middleware(req("https://timewren.com/delete-account")));
  expect(r.location).toBeNull();
  expect(r.rewrite).toBe(
    "https://timewren.com/timewren-site/en/delete-account",
  );
});

describe("TimeWren-marketing: routing", () => {
  it.each([
    ["/", "/timewren-site/en", "en"],
    ["/pricing", "/timewren-site/en/pricing", "en"],
    ["/self-hosting", "/timewren-site/en/self-hosting", "en"],
    ["/privacy", "/timewren-site/en/privacy", "en"],
    ["/terms", "/timewren-site/en/terms", "en"],
    ["/da", "/timewren-site/da", "da"],
    ["/da/pricing", "/timewren-site/da/pricing", "da"],
    ["/de/pricing", "/timewren-site/de/pricing", "de"],
    ["/es", "/timewren-site/es", "es"],
  ])("timewren.com%s omskrives til %s (%s)", (path, internal, locale) => {
    const r = snap(middleware(req(`https://timewren.com${path}`)));
    expect(r.rewrite).toBe(`https://timewren.com${internal}`);
    expect(r.locale).toBe(locale);
    expect(r.robots).toBeNull();
  });

  it("sproget i URL'en vinder altid over cookie og Accept-Language", () => {
    const r = snap(
      middleware(
        req("https://timewren.com/pricing", {
          "accept-language": "da-DK,da",
          cookie: "locale=de",
        }),
      ),
    );
    expect(r.rewrite).toBe("https://timewren.com/timewren-site/en/pricing");
  });

  it("www-hosten viser også marketing", () => {
    const r = snap(middleware(req("https://www.timewren.com/da")));
    expect(r.rewrite).toBe("https://www.timewren.com/timewren-site/da");
  });

  it("/en/… og afsluttende skråstreg 308-redirecter til kanonisk form", () => {
    const a = snap(middleware(req("https://timewren.com/en/pricing?x=1")));
    expect(a.status).toBe(308);
    expect(a.location).toBe("https://timewren.com/pricing?x=1");
    expect(snap(middleware(req("https://timewren.com/en"))).location).toBe(
      "https://timewren.com/",
    );
  });

  it.each(["de", "es", "da"])(
    "%s: privacy og terms omskrives uden omdirigering",
    (locale) => {
      for (const page of ["privacy", "terms"]) {
        const r = snap(
          middleware(req(`https://timewren.com/${locale}/${page}?x=1`)),
        );
        expect(r.rewrite).toBe(
          `https://timewren.com/timewren-site/${locale}/${page}?x=1`,
        );
        expect(r.locale).toBe(locale);
        expect(r.location).toBeNull();
        expect(r.status).toBe(200);
      }
    },
  );

  it("kanonisk redirect bruger Host-headeren, ikke serverens adresse", () => {
    // Som bag en proxy: next start lytter på 127.0.0.1, Host er timewren.com.
    const r = snap(
      middleware(
        new NextRequest("http://127.0.0.1:3000/en/privacy?x=1", {
          headers: { host: "timewren.com" },
        }),
      ),
    );
    expect(r.status).toBe(308);
    expect(r.location).toBe("https://timewren.com/privacy?x=1");
  });

  it("appen kører kun på primærhosten: app.- og www.-hosten sender dertil", () => {
    for (const [from, to] of [
      ["https://app.timewren.com/", "https://timewren.com/"],
      [
        "https://app.timewren.com/dashboard?x=1",
        "https://timewren.com/dashboard?x=1",
      ],
      ["https://app.timewren.com/pricing", "https://timewren.com/pricing"],
      ["https://www.timewren.com/login", "https://timewren.com/login"],
      ["https://www.timewren.com/de/login", "https://timewren.com/de/login"],
    ]) {
      const r = snap(middleware(req(from)));
      expect(r.status).toBe(308);
      expect(r.location).toBe(to);
    }
    // Marketing på www. er uændret.
    expect(
      snap(middleware(req("https://www.timewren.com/pricing"))).status,
    ).not.toBe(308);
  });

  it("uden TIMEWREN_APP_ENABLED redirecter app.-hosten ikke (appen er lukket)", () => {
    vi.stubEnv("TIMEWREN_APP_ENABLED", "");
    const r = snap(middleware(req("https://app.timewren.com/login")));
    expect(r.status).not.toBe(308);
    expect(r.rewrite).toContain("/_marketing-disabled");
  });

  it("link-preview-billedet findes på marketinghosten", () => {
    const r = snap(middleware(req("https://timewren.com/opengraph-image")));
    expect(r.rewrite ?? "").not.toContain("/_marketing-disabled");
    expect(r.location).toBeNull();
  });

  it("appens stier virker fortsat på marketinghosten (også med sprog)", () => {
    const login = snap(middleware(req("https://timewren.com/da/login")));
    expect(login.rewrite).toBe("https://timewren.com/login");
    expect(login.locale).toBe("da");
  });

  it("TimeTracks marketingsider findes ikke på TimeWren-hosten", () => {
    for (const p of ["/klippekort", "/priser", "/da/klippekort", "/blog"]) {
      const r = snap(middleware(req(`https://timewren.com${p}`)));
      expect(r.rewrite).toContain("/_marketing-disabled");
    }
  });

  it("den interne sti giver 404 på alle hosts, med og uden flag", () => {
    for (const flag of ["1", ""]) {
      vi.stubEnv("MULTIBRAND_ENABLED", flag);
      for (const host of ["timewren.com", "timetrack.dk", "localhost:3000"]) {
        const r = snap(middleware(req(`https://${host}/timewren-site/en`)));
        expect(r.rewrite).toContain("/_marketing-disabled");
      }
    }
  });

  it("uden flaget er timewren.com bare en ukendt host (ingen marketing)", () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://timetrack.dk");
    const r = snap(middleware(req("https://timewren.com/pricing")));
    expect(r.rewrite).toBeNull();
    expect(r.locale).toBeNull();
  });
});

describe("TimeWren-marketing: indeksering", () => {
  it("legacy TIMEWREN_INDEXABLE=0 kan ikke noindexe marketing; appen forbliver noindex", () => {
    vi.stubEnv("TIMEWREN_INDEXABLE", "0");
    for (const p of [
      "/",
      "/pricing",
      "/da",
      "/da/pricing",
      "/de/pricing",
      "/es",
      "/docs",
      "/da/docs",
      "/sitemap.xml",
    ]) {
      const r = snap(middleware(req(`https://timewren.com${p}`)));
      expect(r.robots, p).toBeNull();
    }
    expect(snap(middleware(req("https://timewren.com/login"))).robots).toBe(
      "noindex, nofollow",
    );
    expect(snap(middleware(req("https://timewren.com/dashboard"))).robots).toBe(
      "noindex, nofollow",
    );
  });

  it("robots.txt og sitemap.xml omskrives til TimeWren-handlerne", () => {
    expect(
      snap(middleware(req("https://timewren.com/robots.txt"))).rewrite,
    ).toBe("https://timewren.com/timewren-site/robots");
    expect(
      snap(middleware(req("https://app.timewren.com/robots.txt"))).rewrite,
    ).toBe("https://app.timewren.com/timewren-site/robots");
    expect(
      snap(middleware(req("https://timewren.com/sitemap.xml"))).rewrite,
    ).toBe("https://timewren.com/timewren-site/sitemap");
    // app.-hosten har ingen sitemap; den sendes til primærhosten.
    expect(
      snap(middleware(req("https://app.timewren.com/sitemap.xml"))).location,
    ).toBe("https://timewren.com/sitemap.xml");
  });

  it("sitemap.xml på timetrack-hosts er uændret (som uden matcher)", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.timetrack.dk");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://timetrack.dk");
    for (const flag of ["1", ""]) {
      vi.stubEnv("MULTIBRAND_ENABLED", flag);
      for (const host of ["timetrack.dk", "app.timetrack.dk"]) {
        const r = snap(middleware(req(`https://${host}/sitemap.xml`)));
        expect(r).toEqual({
          status: 200,
          location: null,
          robots: null,
          rewrite: null,
          locale: null,
        });
      }
    }
  });
});

describe("alias-domæner", () => {
  it.each(["timewren.org", "timewren.app", "timewren.io", "timewren.eu"])(
    "%s 308-redirecter til timewren.com med samme sti og query",
    (alias) => {
      const r = snap(
        middleware(req(`https://${alias}/da/pricing?utm_source=x&b=2`)),
      );
      expect(r.status).toBe(308);
      expect(r.location).toBe(
        "https://timewren.com/da/pricing?utm_source=x&b=2",
      );
    },
  );

  it("roden og app-stier redirecter også", () => {
    expect(snap(middleware(req("https://timewren.io/"))).location).toBe(
      "https://timewren.com/",
    );
    expect(
      snap(middleware(req("https://timewren.org/login?next=%2Fx"))).location,
    ).toBe("https://timewren.com/login?next=%2Fx");
  });

  it("www-varianten af et alias redirecter også, men ikke en www-brand-host", () => {
    const r = snap(middleware(req("https://www.timewren.io/pricing?a=1")));
    expect(r.status).toBe(308);
    expect(r.location).toBe("https://timewren.com/pricing?a=1");
    vi.stubEnv(
      "BRANDS_CONFIG",
      JSON.stringify({
        timewren: {
          hosts: ["www.timewren.io", "app.timewren.io"],
          aliasHosts: ["timewren.io"],
        },
      }),
    );
    expect(snap(middleware(req("https://www.timewren.io/"))).status).not.toBe(
      308,
    );
  });

  it("listen kommer fra BRANDS_CONFIG (fx .dk), og primærhosten følger med", () => {
    vi.stubEnv(
      "BRANDS_CONFIG",
      JSON.stringify({
        timewren: {
          hosts: ["timewren.net", "app.timewren.net"],
          aliasHosts: ["timewren.dk"],
        },
      }),
    );
    expect(snap(middleware(req("https://timewren.dk/x"))).location).toBe(
      "https://timewren.net/x",
    );
    // Ikke længere på listen: ingen redirect.
    expect(snap(middleware(req("https://timewren.org/x"))).status).not.toBe(
      308,
    );
  });

  it("uden flaget redirecter alias-domæner ikke", () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    expect(snap(middleware(req("https://timewren.org/"))).status).not.toBe(308);
  });

  it("et alias, der også er en host, afvises (ellers redirect i ring)", () => {
    expect(() =>
      getBrandConfigs(
        JSON.stringify({ timewren: { aliasHosts: ["timewren.com"] } }),
      ),
    ).toThrow(/overlapper/);
    expect(() =>
      getBrandConfigs(
        JSON.stringify({ timewren: { aliasHosts: ["timetrack.dk"] } }),
      ),
    ).toThrow(/overlapper/);
  });
});

describe("rene hjælpere", () => {
  const cfg = getBrandConfigs("").timewren;
  it("sitePath", () => {
    expect(sitePath("/", "en")).toBe("/");
    expect(sitePath("/", "da")).toBe("/da");
    expect(sitePath("/pricing", "es")).toBe("/es/pricing");
  });
  it("ukendte sider og sprog er ikke marketing", () => {
    expect(routeSite(cfg, "timewren.com", "/fr/pricing").action).toBe("none");
    expect(routeSite(cfg, "timewren.com", "/da/blog").action).toBe("none");
    expect(routeSite(cfg, "app.timewren.com", "/").action).toBe("none");
  });
});
