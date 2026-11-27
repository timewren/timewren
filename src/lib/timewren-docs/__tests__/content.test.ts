import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as docsMarkdownGET } from "@/app/(timewren)/timewren-site/docs-md/[locale]/[[...slug]]/route";
import { GET as llmsGET } from "@/app/(timewren)/timewren-site/llms/route";
import { GET as llmsFullGET } from "@/app/(timewren)/timewren-site/llms-full/route";
import {
  DOCS_LOCALES,
  type DocsLocale,
  docsMarkdownPath,
} from "@/lib/brands/timewren-docs";
import { siteSitemapXml } from "@/lib/brands/timewren-site-meta";
import { docsPageMetadata } from "@/lib/timewren-docs/meta";
import {
  DOCS_CONTENT_DIR,
  docsSitemapEntries,
  docsSlugs,
  getDocPage,
  isTranslated,
  llmsFull,
  llmsIndex,
  pageMarkdown,
  parseFrontmatter,
  toPlainMarkdown,
} from "../content";

const BASE = "https://timewren.com";

/** Den fælles kontrakt for de fire TimeWren-job (9/11-2026). */
const CONTRACT_SLUGS = [
  "index",
  "quickstart",
  "concepts/prepaid-hours",
  "install/quick",
  "install/docker-compose",
  "install/coolify",
  "install/dokploy",
  "install/railway",
  "install/render",
  "install/kubernetes",
  "install/from-source",
  "configuration/environment",
  "configuration/email",
  "configuration/storage",
  "configuration/authentication",
  "operations/upgrading",
  "operations/backup-restore",
  "operations/reverse-proxy",
  "operations/troubleshooting",
  "contributing",
  "llm",
];

const key = (slugs: string[]) => (slugs.length ? slugs.join("/") : "index");
const slugsOf = (k: string) => (k === "index" ? [] : k.split("/"));

function rawFile(locale: DocsLocale, slugs: string[]): string {
  return readFileSync(
    path.join(DOCS_CONTENT_DIR, locale, `${key(slugs)}.mdx`),
    "utf8",
  );
}

/** Brødtekst uden kodeblokke og inline-kode. */
function prose(body: string): string {
  return body.replace(/^(```|~~~)[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");
}

beforeEach(() => {
  vi.stubEnv("BRANDS_CONFIG", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Docs-indholdet", () => {
  const all = docsSlugs().map(key);

  it("alle kontraktens sider findes og er med i navigationen", () => {
    for (const slug of CONTRACT_SLUGS) expect(all).toContain(slug);
    // integrations/*, apps/* og api/* (kontrakten lister dem som grupper).
    for (const group of ["integrations", "apps", "api"]) {
      expect(all.some((s) => s.startsWith(`${group}/`))).toBe(true);
    }
  });

  it("ingen sidefil står uden for navigationen", () => {
    const files = execFileSync(
      "git",
      [
        "ls-files",
        "--others",
        "--cached",
        "--exclude-standard",
        "content/docs/en",
      ],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((f) => f.endsWith(".mdx"))
      .map((f) => f.replace(/^content\/docs\/en\//, "").replace(/\.mdx$/, ""));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(all).toContain(f);
  });

  it.each(DOCS_LOCALES)(
    "%s: alle sider er oversat (ingen fallback)",
    (locale) => {
      const missing = docsSlugs().filter((s) => !isTranslated(locale, s));
      expect(missing.map(key)).toEqual([]);
    },
  );

  it.each(DOCS_LOCALES)(
    "%s: frontmatter, kun tilladte komponenter og ingen tankestreger",
    (locale) => {
      for (const slugs of docsSlugs()) {
        if (!isTranslated(locale, slugs)) continue;
        const { data, body } = parseFrontmatter(rawFile(locale, slugs));
        const where = `${locale}/${key(slugs)}`;
        expect(data.title, where).toBeTruthy();
        expect(data.description, where).toBeTruthy();
        expect(data.description.length, where).toBeLessThanOrEqual(200);
        const text = prose(body);
        // Kun <Screenshot … />; ingen anden JSX/HTML i brødteksten.
        const tags = text.match(/<\/?[A-Za-z][^>\n]*>/g) ?? [];
        for (const tag of tags) {
          expect(tag, where).toMatch(/^<Screenshot\s[^>]*\/>$/);
        }
        // MDX læser { } som udtryk og < som JSX: i brødtekst knækker de buildet.
        const unsafe = text
          .replace(/<Screenshot\s[^>]*\/>/g, "")
          .match(/[{}]|<(?!\s|=)/g);
        expect(unsafe, `${where}: MDX-tegn i brødtekst`).toBeNull();
        expect(body.includes("\u2014"), `${where}: em dash`).toBe(false);
        expect(/^# /m.test(text), `${where}: H1 i brødteksten`).toBe(false);
      }
    },
  );

  it.each(DOCS_LOCALES)(
    "%s: alle interne docs-links peger på sider, der findes",
    (locale) => {
      const known = new Set(all);
      const bad: string[] = [];
      for (const slugs of docsSlugs()) {
        if (!isTranslated(locale, slugs)) continue;
        const text = prose(parseFrontmatter(rawFile(locale, slugs)).body);
        for (const m of text.matchAll(
          /\]\((\/(?:([a-z]{2})\/)?docs(?:\/([a-z0-9/-]*))?)(?:#[^)]*)?\)/g,
        )) {
          const [, href, prefix, rest] = m;
          const target = rest ? rest.replace(/\/$/, "") : "index";
          // Links i en oversættelse skal blive på samme sprog.
          const expected = locale === "en" ? undefined : locale;
          if (!known.has(target) || prefix !== expected) {
            bad.push(`${locale}/${key(slugs)} → ${href}`);
          }
        }
        // Absolutte links til timewren.com/docs skal også ramme en side.
        for (const m of text.matchAll(
          /https:\/\/timewren\.com\/(?:([a-z]{2})\/)?docs(?:\/([a-z0-9/-]*?))?(?:\.md)?(?=[)\s`"#]|$)/g,
        )) {
          const target = m[2] ? m[2].replace(/\/$/, "") : "index";
          if (!known.has(target)) bad.push(`${locale}/${key(slugs)} → ${m[0]}`);
        }
      }
      expect(bad).toEqual([]);
    },
  );

  it("kodeblokke har et sprog, Shiki kender (ellers fejler MDX-buildet)", async () => {
    const { bundledLanguages } = await import("shiki");
    const bad: string[] = [];
    for (const locale of DOCS_LOCALES) {
      for (const slugs of docsSlugs()) {
        if (!isTranslated(locale, slugs)) continue;
        for (const m of rawFile(locale, slugs).matchAll(/^\s*```(\S*)/gm)) {
          const lang = m[1];
          // Afsluttende ``` har intet sprog; åbnende skal have et kendt.
          if (lang && lang !== "text" && !(lang in bundledLanguages)) {
            bad.push(`${locale}/${key(slugs)}: ${lang}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("skærmbilleder: kun kendte navne", () => {
    const names = new Set([
      "dashboard",
      "timer",
      "prepaid-hours",
      "invoices",
      "clients",
      "projects",
      "tasks",
      "reports",
      "calendar",
      "mobile-dashboard",
    ]);
    for (const locale of DOCS_LOCALES) {
      for (const slugs of docsSlugs()) {
        if (!isTranslated(locale, slugs)) continue;
        for (const m of rawFile(locale, slugs).matchAll(
          /<Screenshot\s+name="([^"]+)"\s+alt="[^"]+"\s*\/>/g,
        )) {
          expect(names.has(m[1]), `${locale}/${key(slugs)}: ${m[1]}`).toBe(
            true,
          );
        }
      }
    }
  });
});

describe("Markdown til LLM'er", () => {
  it("manglende skærmbillede forsvinder; interne links bliver absolutte .md", () => {
    const md = toPlainMarkdown(
      'Intro.\n\n<Screenshot name="does-not-exist" alt="x" />\n\nSee [Upgrading](/docs/operations/upgrading#backup) and [Dansk](/da/docs).\n\n```bash\necho "[x](/docs/llm)"\n```\n',
      "en",
      BASE,
    );
    expect(md).not.toContain("Screenshot");
    expect(md).not.toContain("does-not-exist");
    expect(md).toContain(
      "[Upgrading](https://timewren.com/docs/operations/upgrading.md#backup)",
    );
    expect(md).toContain("[Dansk](https://timewren.com/da/docs.md)");
    // Kodeblokke røres ikke.
    expect(md).toContain('echo "[x](/docs/llm)"');
  });

  it("skærmbillede findes: sprogets fil, ellers engelsk", () => {
    const pub = path.join(process.cwd(), "public/brand/timewren/screens");
    const enDash = existsSync(path.join(pub, "en/dashboard.webp"));
    const md = toPlainMarkdown(
      '<Screenshot name="dashboard" alt="Dash" />',
      "da",
      BASE,
    );
    if (existsSync(path.join(pub, "da/dashboard.webp"))) {
      expect(md).toContain("/brand/timewren/screens/da/dashboard.webp");
    } else if (enDash) {
      expect(md).toContain("/brand/timewren/screens/en/dashboard.webp");
    } else {
      expect(md.trim()).toBe("");
    }
  });

  it("en side som Markdown har titel, beskrivelse og kilde-URL", () => {
    const page = getDocPage("da", ["quickstart"]);
    expect(page).not.toBeNull();
    const md = pageMarkdown(page!, BASE);
    expect(md.startsWith(`# ${page!.title}\n`)).toBe(true);
    expect(md).toContain(`> ${page!.description}`);
    expect(md).toContain("Source: https://timewren.com/da/docs/quickstart");
  });

  it("llms.txt følger llmstxt.org og linker hver side som .md", () => {
    const txt = llmsIndex(BASE);
    expect(txt.startsWith("# TimeWren\n\n> ")).toBe(true);
    expect(txt).toContain("## Optional");
    expect(txt).toContain(`${BASE}/llms-full.txt`);
    for (const slugs of docsSlugs()) {
      expect(txt).toContain(`](${BASE}${docsMarkdownPath(slugs, "en")})`);
    }
  });

  it("llms-full.txt har hele den engelske dokumentation", () => {
    const full = llmsFull(BASE);
    for (const slugs of docsSlugs()) {
      const page = getDocPage("en", slugs)!;
      expect(full).toContain(`# ${page.title}\n`);
      expect(full).toContain(
        `Source: ${BASE}${slugs.length ? `/docs/${slugs.join("/")}` : "/docs"}\n`,
      );
    }
    expect(full).not.toContain("<Screenshot");
  });
});

describe("Ruterne", () => {
  it("/llms.txt svarer med text/plain og alle sider", async () => {
    const res = llmsGET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    for (const slugs of docsSlugs()) {
      expect(body).toContain(docsMarkdownPath(slugs, "en"));
    }
  });

  it("/llms-full.txt svarer med text/plain og alle sider", async () => {
    const res = llmsFullGET();
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body.split("\nSource: ").length - 1).toBe(docsSlugs().length);
  });

  it.each(DOCS_LOCALES)(
    "%s: hver side svarer som text/markdown på <sti>.md",
    async (locale) => {
      for (const slugs of docsSlugs()) {
        const res = await docsMarkdownGET(new Request(`${BASE}/x`), {
          params: Promise.resolve({ locale, slug: slugs }),
        });
        expect(res.status, key(slugs)).toBe(200);
        expect(res.headers.get("content-type")).toBe(
          "text/markdown; charset=utf-8",
        );
        const body = await res.text();
        expect(body).toContain(`# ${getDocPage(locale, slugs)!.title}`);
      }
    },
  );

  it("ukendt side og ukendt sprog giver 404", async () => {
    for (const params of [
      { locale: "en", slug: ["nope"] },
      { locale: "fr", slug: ["quickstart"] },
    ]) {
      const res = await docsMarkdownGET(new Request(`${BASE}/x`), {
        params: Promise.resolve(params),
      });
      expect(res.status).toBe(404);
    }
  });
});

describe("Sitemap og hreflang", () => {
  it("legacy TIMEWREN_INDEXABLE=0 kan ikke noindexe HTML-docs", () => {
    vi.stubEnv("TIMEWREN_INDEXABLE", "0");
    expect(
      docsPageMetadata({
        locale: "en",
        slugs: ["quickstart"],
        title: "Quickstart",
      }).robots,
    ).toEqual({ index: true, follow: true });
  });

  it("docs-siderne er med i TimeWren-sitemap'en på alle sprog", () => {
    const xml = siteSitemapXml(BASE, docsSitemapEntries());
    for (const k of CONTRACT_SLUGS) {
      const slugs = slugsOf(k);
      for (const l of DOCS_LOCALES) {
        const p = l === "en" ? "/docs" : `/${l}/docs`;
        const url = `${BASE}${p}${slugs.length ? `/${slugs.join("/")}` : ""}`;
        expect(xml).toContain(`<loc>${url}</loc>`);
        expect(xml).toContain(`hreflang="${l}" href="${url}"`);
      }
    }
  });
});

describe("Environment-siden", () => {
  /** Alle env-variabler, som app-koden læser (uden tests). */
  function envVarsInCode(): string[] {
    const files = execFileSync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "src",
        "next.config.ts",
        "sentry.*.ts",
        "instrumentation*.ts",
        "scripts/migrate-safe.ts",
        "scripts/lib",
      ],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
      .filter((f) => !/\.test\.|__tests__|\/tests?\//.test(f));
    const names = new Set<string>();
    const patterns = [
      /process\.env\.([A-Z][A-Z0-9_]+)/g,
      /process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g,
      /[^\w.]env\.([A-Z][A-Z0-9_]+)/g,
      /\benv:\s*"([A-Z][A-Z0-9_]+)"/g,
      /_ENV\s*=\s*"([A-Z][A-Z0-9_]+)"/g,
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const re of patterns) {
        for (const m of src.matchAll(re)) names.add(m[1]);
      }
    }
    // Ikke variabler: præfikset selv og en pladsholder i en kommentar.
    for (const fake of ["NEXT_PUBLIC_", "NAVN"]) names.delete(fake);
    return [...names].sort();
  }

  /** Variablerne i .env.example (også de udkommenterede). */
  function envExampleVars(): string[] {
    const src = readFileSync(".env.example", "utf8");
    return [...src.matchAll(/^#?\s?([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
  }

  it("nævner hver env-variabel, koden og .env.example kender", () => {
    const page = rawFile("en", ["configuration", "environment"]);
    const vars = new Set([...envVarsInCode(), ...envExampleVars()]);
    expect(vars.size).toBeGreaterThan(150);
    const missing = [...vars].filter((v) => !page.includes(`\`${v}\``));
    expect(missing).toEqual([]);
  });

  it.each(DOCS_LOCALES.filter((l) => l !== "en"))(
    "%s: oversættelsen nævner de samme variabler som den engelske",
    (locale) => {
      const en = rawFile("en", ["configuration", "environment"]);
      const tr = rawFile(locale, ["configuration", "environment"]);
      const names = (s: string) =>
        new Set([...s.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map((m) => m[1]));
      const missing = [...names(en)].filter((v) => !names(tr).has(v));
      expect(missing).toEqual([]);
    },
  );
});
