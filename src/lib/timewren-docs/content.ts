import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  DOCS_DEFAULT_LOCALE,
  DOCS_LOCALES,
  type DocsLocale,
  docsMarkdownPath,
  docsPath,
} from "@/lib/brands/timewren-docs";

/*
 * TimeWren-docs som Markdown, læst direkte fra content/docs/<sprog>/**.mdx.
 * Bruges af /llms.txt, /llms-full.txt, <side>.md og sitemap'en. HTML-siderne
 * renderes af Fumadocs (source.ts) fra de samme filer.
 *
 * Filerne følger docs-konventionen: frontmatter med title og description,
 * ren Markdown + GFM og kun én komponent, <Screenshot name="…" alt="…" />.
 * Sider, der mangler på et sprog, falder tilbage til den engelske fil.
 */

export const DOCS_CONTENT_DIR = path.join(process.cwd(), "content", "docs");
const PUBLIC_DIR = path.join(process.cwd(), "public");

export interface DocPage {
  /** Sproget, siden vises på (URL'en). */
  locale: DocsLocale;
  /** Sproget, teksten faktisk er skrevet på (en ved fallback). */
  contentLocale: DocsLocale;
  slugs: string[];
  title: string;
  description: string;
  /** Markdown-brødteksten efter frontmatter (rå MDX). */
  body: string;
}

export interface DocsGroup {
  /** Gruppens titel fra meta.json (engelsk); null for rodsiderne. */
  title: string | null;
  pages: string[][];
}

interface Meta {
  title?: string;
  pages?: string[];
}

function readMeta(dir: string): Meta {
  const file = path.join(dir, "meta.json");
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Meta;
}

function fileFor(locale: DocsLocale, slugs: readonly string[]): string {
  const rel = slugs.length ? slugs.join("/") : "index";
  return path.join(DOCS_CONTENT_DIR, locale, `${rel}.mdx`);
}

/** Frontmatter med `key: "værdi"`-linjer (konventionen) + brødtekst. */
export function parseFrontmatter(source: string): {
  data: Record<string, string>;
  body: string;
} {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: source };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const raw = kv[2].trim();
    let value = raw;
    if (raw.startsWith('"')) {
      value = JSON.parse(raw) as string;
    } else if (raw.startsWith("'") && raw.endsWith("'")) {
      value = raw.slice(1, -1).replace(/''/g, "'");
    }
    data[kv[1]] = value;
  }
  return { data, body: source.slice(m[0].length) };
}

/**
 * Siderne i sidebar-rækkefølge, grupperet som i den engelske meta.json:
 * rodens `pages` lister sider og mapper; hver mappe har sin egen meta.json.
 */
export function docsGroups(): DocsGroup[] {
  const root = path.join(DOCS_CONTENT_DIR, DOCS_DEFAULT_LOCALE);
  const groups: DocsGroup[] = [{ title: null, pages: [] }];
  const walk = (dir: string, prefix: string[], group: DocsGroup) => {
    for (const item of readMeta(dir).pages ?? []) {
      const sub = path.join(dir, item);
      if (existsSync(sub) && statSync(sub).isDirectory()) {
        const child: DocsGroup = {
          title: readMeta(sub).title ?? item,
          pages: [],
        };
        groups.push(child);
        walk(sub, [...prefix, item], child);
      } else if (existsSync(`${sub}.mdx`)) {
        group.pages.push(item === "index" ? prefix : [...prefix, item]);
      }
    }
  };
  walk(root, [], groups[0]);
  return groups.filter((g) => g.pages.length > 0);
}

/** Alle sider (slugs) i rækkefølge. */
export function docsSlugs(): string[][] {
  return docsGroups().flatMap((g) => g.pages);
}

/** Findes siden på dette sprog som egen fil (ikke kun som fallback)? */
export function isTranslated(
  locale: DocsLocale,
  slugs: readonly string[],
): boolean {
  return existsSync(fileFor(locale, slugs));
}

export function getDocPage(
  locale: DocsLocale,
  slugs: readonly string[],
): DocPage | null {
  const contentLocale = isTranslated(locale, slugs)
    ? locale
    : DOCS_DEFAULT_LOCALE;
  const file = fileFor(contentLocale, slugs);
  if (!existsSync(file)) return null;
  const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
  return {
    locale,
    contentLocale,
    slugs: [...slugs],
    title: data.title ?? slugs.at(-1) ?? "TimeWren",
    description: data.description ?? "",
    body,
  };
}

export function getDocPages(locale: DocsLocale): DocPage[] {
  return docsSlugs()
    .map((slugs) => getDocPage(locale, slugs))
    .filter((p): p is DocPage => p !== null);
}

/** Skærmbilledets offentlige sti på sproget, ellers engelsk, ellers null. */
export function screenshotPath(
  name: string,
  locale: DocsLocale,
): string | null {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  for (const l of [locale, DOCS_DEFAULT_LOCALE]) {
    const rel = `/brand/timewren/screens/${l}/${name}.webp`;
    if (existsSync(path.join(PUBLIC_DIR, rel))) return rel;
  }
  return null;
}

const SCREENSHOT = /<Screenshot\s+([^>]*?)\/>/g;

function attr(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

/**
 * MDX → ren Markdown til LLM'er: skærmbilleder bliver billeder (eller
 * forsvinder, hvis filen mangler), og interne links bliver absolutte
 * .md-URL'er, så en agent kan følge dem direkte.
 */
export function toPlainMarkdown(
  body: string,
  locale: DocsLocale,
  base: string,
): string {
  const lines = body.split("\n");
  let inFence = false;
  const out = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return line;
    return line
      .replace(SCREENSHOT, (_all, attrs: string) => {
        const src = screenshotPath(attr(attrs, "name") ?? "", locale);
        return src ? `![${attr(attrs, "alt") ?? ""}](${base}${src})` : "";
      })
      .replace(
        /\]\((\/(?:[a-z]{2}\/)?docs(?:\/[a-z0-9/-]*)?)(#[^)]*)?\)/g,
        (_all, href: string, hash: string | undefined) =>
          `](${base}${href}.md${hash ?? ""})`,
      );
  });
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

/** En side som selvstændigt Markdown-dokument (<sti>.md). */
export function pageMarkdown(page: DocPage, base: string): string {
  const url = `${base}${docsPath(page.slugs, page.locale)}`;
  const head = [`# ${page.title}`, ""];
  if (page.description) head.push(`> ${page.description}`, "");
  head.push(`Source: ${url}`, "");
  return `${head.join("\n")}\n${toPlainMarkdown(page.body, page.contentLocale, base)}`;
}

const SUMMARY =
  "TimeWren is open-source time tracking with prepaid hours, clients, projects, tasks and invoicing. It is self-hosted with Docker (one image, PostgreSQL, a small cron container) and has a REST API and an MCP server.";

/** /llms.txt efter llmstxt.org: titel, resumé og links til hver side som .md. */
export function llmsIndex(base: string): string {
  const out = [
    "# TimeWren",
    "",
    `> ${SUMMARY}`,
    "",
    `Every page below is plain Markdown. The whole English documentation in one file: ${base}/llms-full.txt. Source code: https://github.com/timewren/timewren. The docs are also available in Danish (${base}/da/docs), German (${base}/de/docs) and Spanish (${base}/es/docs).`,
    "",
  ];
  for (const group of docsGroups()) {
    out.push(`## ${group.title ?? "Docs"}`, "");
    for (const slugs of group.pages) {
      const page = getDocPage(DOCS_DEFAULT_LOCALE, slugs);
      if (!page) continue;
      const url = `${base}${docsMarkdownPath(slugs, DOCS_DEFAULT_LOCALE)}`;
      out.push(
        `- [${page.title}](${url})${page.description ? `: ${page.description}` : ""}`,
      );
    }
    out.push("");
  }
  out.push(
    "## Optional",
    "",
    `- [Full documentation](${base}/llms-full.txt): every page above in one Markdown file`,
    "",
  );
  return out.join("\n");
}

/** /llms-full.txt: hele den engelske dokumentation i én Markdown-fil. */
export function llmsFull(base: string): string {
  const pages = getDocPages(DOCS_DEFAULT_LOCALE).map((p) =>
    pageMarkdown(p, base).trim(),
  );
  return `# TimeWren documentation\n\n> ${SUMMARY}\n\n---\n\n${pages.join("\n\n---\n\n")}\n`;
}

/** Til sitemap og hreflang: siderne og de sprog, de findes oversat på. */
export function docsSitemapEntries(): {
  slugs: string[];
  locales: DocsLocale[];
}[] {
  return docsSlugs().map((slugs) => ({
    slugs,
    locales: DOCS_LOCALES.filter((l) => isTranslated(l, slugs)),
  }));
}

/** Alle sprogmapper, der findes (til tests og statiske parametre). */
export function docsContentLocales(): DocsLocale[] {
  if (!existsSync(DOCS_CONTENT_DIR)) return [];
  const dirs = new Set(readdirSync(DOCS_CONTENT_DIR));
  return DOCS_LOCALES.filter((l) => dirs.has(l));
}
