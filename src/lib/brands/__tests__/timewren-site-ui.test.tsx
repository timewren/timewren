import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getContrastRatio, mixHex } from "@/lib/color-contrast";
import { RAW_SITE_MESSAGES } from "../timewren-site-copy";
import {
  siteMetadata,
  siteRobotsTxt,
  siteSitemapXml,
} from "../timewren-site-meta";

vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "display" }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

afterEach(() => vi.unstubAllEnvs());

const SITE_DIR = join(
  process.cwd(),
  "src/app/(timewren)/timewren-site/[locale]",
);

type Obj = Record<string, unknown>;
function leafKeys(o: unknown, prefix = ""): string[] {
  if (!o || typeof o !== "object" || Array.isArray(o)) return [prefix];
  return Object.entries(o as Obj).flatMap(([k, v]) =>
    leafKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}
function strings(o: unknown): string[] {
  if (typeof o === "string") return [o];
  if (Array.isArray(o)) return o.flatMap(strings);
  if (o && typeof o === "object") return Object.values(o).flatMap(strings);
  return [];
}

describe("tekster", () => {
  const en = leafKeys(RAW_SITE_MESSAGES.en);
  it.each(["da", "de", "es"] as const)("%s har samme nøgler som en", (l) => {
    const own = leafKeys(RAW_SITE_MESSAGES[l]);
    expect(own.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.filter((k) => !own.includes(k))).toEqual([]);
  });

  it.each(["da", "de", "es"] as const)(
    "%s: lister har samme længde som en",
    (l) => {
      const walk = (a: unknown, b: unknown, path: string) => {
        if (Array.isArray(a)) {
          expect(Array.isArray(b), path).toBe(true);
          expect((b as unknown[]).length, path).toBe(a.length);
          a.forEach((x, i) => {
            walk(x, (b as unknown[])[i], `${path}[${i}]`);
          });
        } else if (a && typeof a === "object") {
          for (const [k, v] of Object.entries(a as Obj)) {
            const bv = (b as Obj | undefined)?.[k];
            if (bv !== undefined) walk(v, bv, `${path}.${k}`);
          }
        }
      };
      walk(RAW_SITE_MESSAGES.en, RAW_SITE_MESSAGES[l], l);
    },
  );

  it("ingen tankestreger, midterpunktummer eller versal-eyebrows", () => {
    for (const l of ["en", "da", "de", "es"] as const) {
      for (const s of strings(RAW_SITE_MESSAGES[l])) {
        expect(s, `${l}: ${s}`).not.toMatch(/[—–·]/);
      }
    }
  });
});

describe("kontrast (WCAG AA) i begge temaer", () => {
  const css = readFileSync(join(SITE_DIR, "site.css"), "utf8");
  const [light, dark] = [
    css.slice(css.indexOf(":root {"), css.indexOf("@media")),
    css.slice(css.indexOf("@media (prefers-color-scheme: dark)")),
  ];
  const token = (block: string, name: string): string => {
    const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
    if (!m) throw new Error(`mangler --${name}`);
    const v = m[1].trim();
    const rgba = v.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/);
    if (!rgba) return v;
    const hex = `#${[rgba[1], rgba[2], rgba[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
    // Gennemsigtig farve blandes på den baggrund, den står på (worst case: band).
    return mixHex(hex, token(block, "band"), Number(rgba[4]));
  };

  it.each([
    ["lys", () => light],
    ["mørk", () => dark],
  ])("%s", (_name, block) => {
    const b = block();
    const t = (n: string) => token(b, n);
    for (const bg of [t("bg"), t("band")]) {
      expect(getContrastRatio(t("text"), bg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(t("muted"), bg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(t("link"), bg)).toBeGreaterThanOrEqual(4.5);
      // Klippede huller og fokusring: ikke-tekst, 3:1.
      expect(getContrastRatio(t("punch"), bg)).toBeGreaterThanOrEqual(3);
      expect(getContrastRatio(t("focus"), bg)).toBeGreaterThanOrEqual(3);
    }
    expect(getContrastRatio(t("btn-text"), t("btn-bg"))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      getContrastRatio(t("code-text"), t("code-bg")),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("kun brandkittets farver (og hvid)", () => {
    const allowed = [
      "#1c2119",
      "#8a5a2b",
      "#3f5a3a",
      "#e8ede3",
      "#e8b04b",
      "#ffffff",
    ];
    const hexes = css.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(hexes.length).toBeGreaterThan(0);
    for (const h of hexes) expect(allowed).toContain(h.toLowerCase());
  });
});

describe("metadata og SEO", () => {
  it("canonical, hreflang og x-default pr. sprog", () => {
    const m = siteMetadata("/pricing", "da");
    expect(m.alternates?.canonical).toBe("https://timewren.com/da/pricing");
    expect(m.alternates?.languages).toEqual({
      en: "https://timewren.com/pricing",
      da: "https://timewren.com/da/pricing",
      de: "https://timewren.com/de/pricing",
      es: "https://timewren.com/es/pricing",
      "x-default": "https://timewren.com/pricing",
    });
    expect(m.openGraph?.images).toEqual([
      expect.objectContaining({ url: "/brand/timewren/og-image.png" }),
    ]);
  });

  it("og:locale har formen sprog_OMRÅDE på alle sprog", () => {
    const tags = (["en", "da", "de", "es"] as const).map((l) => {
      const og = siteMetadata("/", l).openGraph as { locale?: string };
      return og.locale;
    });
    expect(tags).toEqual(["en_US", "da_DK", "de_DE", "es_ES"]);
  });

  it("juridiske sider har alle fire sprog", () => {
    const m = siteMetadata("/privacy", "da");
    expect(m.alternates?.canonical).toBe("https://timewren.com/da/privacy");
    expect(m.alternates?.languages).toEqual({
      en: "https://timewren.com/privacy",
      da: "https://timewren.com/da/privacy",
      de: "https://timewren.com/de/privacy",
      es: "https://timewren.com/es/privacy",
      "x-default": "https://timewren.com/privacy",
    });
    expect(m.title).toBe("Privatlivspolitik | TimeWren");
    expect(JSON.stringify(siteMetadata("/terms", "en"))).not.toMatch(/draft/i);
  });

  it("noindex uden TIMEWREN_INDEXABLE, index med", () => {
    vi.stubEnv("TIMEWREN_INDEXABLE", "");
    expect(siteMetadata("/", "en").robots).toEqual({
      index: false,
      follow: false,
    });
    vi.stubEnv("TIMEWREN_INDEXABLE", "1");
    expect(siteMetadata("/", "en").robots).toEqual({
      index: true,
      follow: true,
    });
  });

  it("primærhosten følger BRANDS_CONFIG", () => {
    vi.stubEnv(
      "BRANDS_CONFIG",
      JSON.stringify({ timewren: { hosts: ["timewren.example"] } }),
    );
    expect(siteMetadata("/", "de").alternates?.canonical).toBe(
      "https://timewren.example/de",
    );
  });

  it("sitemap: 4 sprog på alle sider", () => {
    const xml = siteSitemapXml("https://timewren.com");
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toHaveLength(5 * 4);
    expect(locs).toContain("https://timewren.com/es/self-hosting");
    expect(locs).toContain("https://timewren.com/privacy");
    expect(locs).toContain("https://timewren.com/da/terms");
    expect(locs).toContain("https://timewren.com/de/privacy");
    expect(xml).toContain(
      'hreflang="x-default" href="https://timewren.com/pricing"',
    );
  });

  it("robots.txt: sitemap kun på marketinghosten med flaget", () => {
    vi.stubEnv("TIMEWREN_INDEXABLE", "");
    expect(siteRobotsTxt(true)).toBe("User-agent: *\nAllow: /\n");
    vi.stubEnv("TIMEWREN_INDEXABLE", "1");
    expect(siteRobotsTxt(true)).toContain(
      "Sitemap: https://timewren.com/sitemap.xml",
    );
    expect(siteRobotsTxt(false)).toBe("User-agent: *\nAllow: /\n");
  });
});

async function render(path: string, locale: string) {
  const mod = await import(
    `@/app/(timewren)/timewren-site/[locale]/${path}page`
  );
  const el = await mod.default({ params: Promise.resolve({ locale }) });
  return renderToStaticMarkup(el);
}

describe("sider", () => {
  it.each(["en", "da", "de", "es"])(
    "forsiden på %s: hero, klippekort, FAQ og sprogmenu",
    async (l) => {
      const html = await render("", l);
      const t = RAW_SITE_MESSAGES[l as "en"].home as Obj;
      expect(html).toContain(t.title as string);
      expect(html.match(/class="hole punched"/g)).toHaveLength(12);
      expect(html).toContain("https://github.com/timewren/timewren");
      expect(html).toContain('href="/de"');
      const faq = (t.faq as { items: unknown[] }).items;
      expect(html.match(/<details>/g)?.length).toBe(faq.length);
      // Ingen sprog mærkes beta i sprogvælgeren.
      expect(html).not.toContain('class="beta"');
    },
  );

  it.each([
    ["en", "privacy/", "Privacy policy", "November 8, 2026", "12. Self-hosted"],
    ["da", "privacy/", "Privatlivspolitik", "8. november 2026", "12. Selvhost"],
    ["en", "terms/", "Terms of service", "November 8, 2026", "Article 28"],
    ["da", "terms/", "Vilkår", "8. november 2026", "artikel 28"],
  ])(
    "%s %s: endelig tekst med dato, uden udkast-mærke",
    async (l, p, title, date, marker) => {
      const html = await render(p, l);
      expect(html).toContain(`<h1>${title}</h1>`);
      expect(html).toContain('<time dateTime="2026-11-08">');
      expect(html).toContain(date);
      expect(html).toContain(marker);
      expect(html).toContain("Mahope");
      expect(html).toContain("CVR 39413892");
      expect(html).toContain('href="mailto:support@timewren.com"');
      expect(html).not.toMatch(/draft|udkast|lawyer|\{email\}|\*\*/i);
    },
  );

  it("privatlivspolitikken lister de samme underdatabehandlere på en og da", async () => {
    for (const l of ["en", "da"]) {
      const html = await render("privacy/", l);
      for (const name of [
        "Hetzner Online GmbH",
        "Resend, Inc.",
        "Sentry",
        "Discord Inc.",
        "Nürnberg",
        "Helsinki",
      ]) {
        expect(html, `${l}: ${name}`).toContain(
          name === "Nürnberg" && l === "en" ? "Nuremberg" : name,
        );
      }
    }
  });

  it("interne links i juridiske tekster bliver på sproget", async () => {
    const da = await render("terms/", "da");
    expect(da).toContain('href="/da/privacy"');
    expect(da).toContain('href="/da/pricing"');
    const en = await render("privacy/", "en");
    expect(en).toContain('href="/terms"');
  });

  it.each(["de", "es"] as const)(
    "%s viser egne juridiske sider med henvisning til den gældende engelske version",
    async (locale) => {
      for (const kind of ["privacy", "terms"] as const) {
        const html = await render(`${kind}/`, locale);
        const legal = RAW_SITE_MESSAGES[locale].legal as Obj;
        expect(html).toContain(`<h1>${(legal[kind] as Obj).title}</h1>`);
        expect(html).toContain(`href="/${kind}" hrefLang="en"`);
        expect(html).toContain(legal.englishPrevails as string);
        expect(html.indexOf(legal.englishPrevails as string)).toBeLessThan(
          html.indexOf('<p class="lead">'),
        );
      }
    },
  );

  it("footeren linker til de juridiske sider på sproget", async () => {
    const da = await render("", "da");
    expect(da).toContain('href="/da/privacy" hrefLang="da"');
    const de = await render("", "de");
    expect(de).toContain('href="/de/privacy" hrefLang="de"');
  });
});
