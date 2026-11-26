import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getBrandConfigs } from "../registry";
import {
  DOCS_SLUGS,
  docsPath,
  INSTALL_METHODS,
  INSTALL_ONE_LINER,
  LLMS_FULL_TXT_PATH,
  LLMS_TXT_PATH,
  resolveScreen,
  SCREEN_NAMES,
  webpSize,
} from "../timewren-landing";
import { routeSite, SITE_LOCALES } from "../timewren-site";
import { RAW_SITE_MESSAGES } from "../timewren-site-copy";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

type Obj = Record<string, unknown>;

/** Alle stier i et katalog, også ind i lister (home.faq.items.3.1). */
function paths(o: unknown, prefix = ""): string[] {
  if (Array.isArray(o)) {
    return o.flatMap((v, i) => paths(v, `${prefix}.${i}`));
  }
  if (o && typeof o === "object") {
    return Object.entries(o as Obj).flatMap(([k, v]) =>
      paths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

function at(o: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, k) => (acc as Obj | undefined)?.[k], o);
}

describe("sprogkataloger", () => {
  const en = paths(RAW_SITE_MESSAGES.en);

  it.each(["da", "de", "es"] as const)(
    "%s har præcis de samme nøgler som en, også i lister",
    (l) => {
      const own = paths(RAW_SITE_MESSAGES[l]);
      expect(own.filter((k) => !en.includes(k))).toEqual([]);
      expect(en.filter((k) => !own.includes(k))).toEqual([]);
    },
  );

  // Fanger engelsk tekst, der er glemt på en oversat forside.
  const SAME_IN_ALL = new Set([
    "TimeWren Cloud",
    "Android",
    "Team",
    "Teams",
    "Support",
    "Updates",
    "Backups",
    "Docker Compose",
    "Coolify",
    "Dokploy",
    "Railway",
    "Render",
    "Kubernetes",
    "REST API",
    "MCP server",
    "MCP-Server",
    "Servidor MCP",
    "MCP-server",
    "available",
    "coming",
    "beta",
    "Legal",
    "Web app",
    "Webapp",
    "Docs",
    "Desktop",
    "Mac",
    "Windows",
    "Open source under AGPL-3.0",
  ]);
  it.each(["da", "de", "es"] as const)(
    "%s: ingen engelske strenge på forsiden, i menu og footer",
    (l) => {
      const untranslated = en
        // Plannavnene følger appen pr. sprog, og "Solo"/"Team" er ens på flere sprog.
        .filter((k) => /^(home|nav|footer|pricing|selfHosting)\./.test(k))
        .filter((k) => !k.startsWith("pricing.plans."))
        .filter((k) => {
          const a = at(RAW_SITE_MESSAGES.en, k);
          const b = at(RAW_SITE_MESSAGES[l], k);
          return (
            typeof a === "string" &&
            a === b &&
            /[a-z]{3}/.test(a) &&
            !SAME_IN_ALL.has(a) &&
            !a.includes("github.com") &&
            !a.endsWith(".txt") &&
            !/^[a-z0-9/-]+$/.test(a)
          );
        });
      expect(untranslated).toEqual([]);
    },
  );
});

describe("installation", () => {
  const compose = readFileSync(
    join(process.cwd(), "docker-compose.yml"),
    "utf8",
  );
  const command = (k: string) =>
    INSTALL_METHODS.find((m) => m.key === k)?.command ?? "";

  it.each(["dockerCompose", "fromSource"])(
    "%s: laver de fire secrets, som docker-compose.yml kræver, før start",
    (k) => {
      const c = command(k);
      for (const v of [
        "POSTGRES_PASSWORD",
        "BETTER_AUTH_SECRET",
        "ENCRYPTION_KEY",
        "CRON_SECRET",
      ]) {
        expect(compose).toContain(`\${${v}:?`);
        expect(c).toContain(v);
      }
      expect(c).toContain("openssl rand -hex 32");
      expect(c.indexOf("openssl")).toBeLessThan(c.indexOf("docker compose up"));
    },
  );

  it("fromSource bygger selv og bruger det lokale image", () => {
    expect(compose).toMatch(
      /image: ghcr\.io\/timewren\/timewren:\$\{TIMEWREN_VERSION:-latest\}/,
    );
    const c = command("fromSource");
    expect(c).toContain("docker build -t ghcr.io/timewren/timewren:local");
    expect(c).toContain("TIMEWREN_VERSION=local >> .env");
    expect(c.indexOf("docker build")).toBeLessThan(
      c.indexOf("docker compose up"),
    );
  });

  it("én-linjen er kontraktens", () => {
    expect(INSTALL_ONE_LINER).toBe(
      "curl -fsSL https://timewren.com/install.sh | bash",
    );
  });

  it("otte måder, hver med kontraktens docs-slug og en tekst på alle sprog", () => {
    expect(INSTALL_METHODS.map((m) => m.docs)).toEqual([
      "install/quick",
      "install/docker-compose",
      "install/coolify",
      "install/dokploy",
      "install/railway",
      "install/render",
      "install/kubernetes",
      "install/from-source",
    ]);
    for (const l of SITE_LOCALES) {
      for (const m of INSTALL_METHODS) {
        const t = at(RAW_SITE_MESSAGES[l], `home.install.methods.${m.key}`);
        expect(t, `${l} ${m.key}`).toEqual({
          name: expect.any(String),
          desc: expect.any(String),
        });
      }
    }
  });

  it("docs-stier følger sitets sprogmønster", () => {
    expect(docsPath("index", "en")).toBe("/docs");
    expect(docsPath("index", "da")).toBe("/da/docs");
    expect(docsPath("install/quick", "en")).toBe("/docs/install/quick");
    expect(docsPath("llm", "es")).toBe("/es/docs/llm");
  });
});

describe("screenshots", () => {
  const files = (...present: string[]) => {
    const set = new Set(present);
    return (p: string) => set.has(p);
  };

  it("bruger sprogets egen fil", () => {
    expect(
      resolveScreen(
        "invoices",
        "da",
        files(
          "/brand/timewren/screens/da/invoices.webp",
          "/brand/timewren/screens/en/invoices.webp",
        ),
      ),
    ).toBe("/brand/timewren/screens/da/invoices.webp");
  });

  it("falder tilbage til en, når sproget mangler", () => {
    expect(
      resolveScreen(
        "invoices",
        "de",
        files("/brand/timewren/screens/en/invoices.webp"),
      ),
    ).toBe("/brand/timewren/screens/en/invoices.webp");
  });

  it("falder tilbage til den gamle fil, og ellers intet billede", () => {
    const none = files("/brand/timewren/screens/dashboard.webp");
    expect(resolveScreen("dashboard", "es", none)).toBe(
      "/brand/timewren/screens/dashboard.webp",
    );
    expect(resolveScreen("tasks", "es", none)).toBeNull();
    expect(resolveScreen("mobile-dashboard", "en", files())).toBeNull();
  });

  it("kender kontraktens ti navne", () => {
    expect(SCREEN_NAMES).toHaveLength(10);
  });

  it("læser mål fra webp-headeren", () => {
    const buf = readFileSync(
      join(process.cwd(), "public/brand/timewren/screens/dashboard.webp"),
    );
    expect(webpSize(buf)).toEqual({ width: 2880, height: 1800 });
    expect(webpSize(new Uint8Array(40))).toBeNull();
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
  const cfg = getBrandConfigs().timewren;
  const host = cfg.hosts[0];
  const docs = new Set(
    SITE_LOCALES.flatMap((l) => DOCS_SLUGS.map((s) => docsPath(s, l))),
  );
  const pages: [string, readonly string[]][] = [
    ["", SITE_LOCALES],
    ["pricing/", SITE_LOCALES],
    ["self-hosting/", SITE_LOCALES],
    ["privacy/", SITE_LOCALES],
    ["terms/", SITE_LOCALES],
  ];

  it.each(pages)(
    "%s: alle interne links peger på en side eller en docs-slug",
    async (path, locales) => {
      for (const l of locales) {
        const html = await render(path, l);
        const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        expect(hrefs.length).toBeGreaterThan(5);
        for (const href of hrefs) {
          if (/^(https:|mailto:|#)/.test(href)) continue;
          const ok =
            routeSite(cfg, host, href).action === "page" ||
            docs.has(href) ||
            href === LLMS_TXT_PATH ||
            href === LLMS_FULL_TXT_PATH;
          expect(ok, `${l} ${path || "/"}: ${href}`).toBe(true);
        }
      }
    },
  );

  it.each(SITE_LOCALES)(
    "forsiden på %s: CTA'er, én-linjen, otte måder, alt-tekst på sproget",
    async (l) => {
      const html = await render("", l);
      const home = RAW_SITE_MESSAGES[l].home as Obj;
      expect(html).toContain(`href="${docsPath("install/quick", l)}"`);
      expect(html).toContain('href="https://github.com/timewren/timewren"');
      expect(html).toContain(
        "curl -fsSL https://timewren.com/install.sh | bash",
      );
      expect(html.match(/<li><h3>/g)?.length).toBeGreaterThanOrEqual(8);
      expect(html).toContain(
        `alt="${(home.heroAlt as string).replaceAll("'", "&#x27;")}"`,
      );
      // Hero hentes med det samme, resten lazy.
      expect(html.match(/loading="lazy"/g)?.length).toBeGreaterThan(0);
      expect(html).toContain('href="mailto:support@timewren.com"');
      expect(html).toContain(`href="${docsPath("llm", l)}"`);
      expect(html).toContain('href="/llms.txt"');
    },
  );

  it("viser kun eksisterende screenshots (ingen ødelagte billeder)", async () => {
    const html = await render("", "de");
    const srcs = [
      ...html.matchAll(/url=(%2Fbrand%2Ftimewren%2Fscreens[^&"]+)/g),
    ].map((m) => decodeURIComponent(m[1]));
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of new Set(srcs)) {
      expect(() =>
        readFileSync(join(process.cwd(), "public", s)),
      ).not.toThrow();
    }
  });
});
