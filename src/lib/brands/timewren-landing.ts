/**
 * Forsidens faste data for TimeWrens marketingsite: docs-adresser,
 * installationsmåder og screenshots. Ren og uden afhængigheder ud over
 * sprogreglerne, så siderne og tests deler den.
 *
 * Navnene følger den fælles kontrakt for TimeWren-jobbene 9/11-2026
 * (docs-slugs, install.sh-adressen og screenshot-filerne).
 */

import type { Locale } from "./registry";
import { SITE_DEFAULT_LOCALE } from "./timewren-site";

/** Docs-sider, som forsiden og undersiderne må linke til (kontraktens slugs). */
export const DOCS_SLUGS = [
  "index",
  "quickstart",
  "install/quick",
  "install/docker-compose",
  "install/coolify",
  "install/dokploy",
  "install/railway",
  "install/render",
  "install/kubernetes",
  "install/from-source",
  "concepts/prepaid-hours",
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
] as const;
export type DocsSlug = (typeof DOCS_SLUGS)[number];

/**
 * Docs-sti på et sprog, samme mønster som resten af sitet: engelsk uden
 * præfiks (/docs/install/quick), øvrige med (/da/docs/install/quick).
 */
export function docsPath(slug: DocsSlug, locale: Locale): string {
  const base = locale === SITE_DEFAULT_LOCALE ? "/docs" : `/${locale}/docs`;
  return slug === "index" ? base : `${base}/${slug}`;
}

/** Filer i roden af timewren.com til LLM'er og kodeagenter. */
export const LLMS_TXT_PATH = "/llms.txt";
export const LLMS_FULL_TXT_PATH = "/llms-full.txt";

export const INSTALL_SCRIPT_URL = "https://timewren.com/install.sh";
export const INSTALL_ONE_LINER = `curl -fsSL ${INSTALL_SCRIPT_URL} | bash`;

const REPO = "https://github.com/timewren/timewren";

/**
 * .env med friske secrets, som docs/self-hosting.md beskriver. Uden dem
 * stopper docker compose før start (docker-compose.yml kræver alle fire).
 * `sed -i.bak` virker med både GNU og BSD sed (macOS).
 */
const ENV_SETUP = [
  `git clone ${REPO}.git && cd timewren`,
  "cp .env.example .env",
  "for v in POSTGRES_PASSWORD BETTER_AUTH_SECRET ENCRYPTION_KEY CRON_SECRET; do",
  '  sed -i.bak "s|^$v=.*|$v=$(openssl rand -hex 32)|" .env',
  "done && rm .env.bak",
].join("\n");

export type InstallMethod = {
  /** Nøgle i home.install.methods.<key> (navn og beskrivelse pr. sprog). */
  key:
    | "quick"
    | "dockerCompose"
    | "coolify"
    | "dokploy"
    | "railway"
    | "render"
    | "kubernetes"
    | "fromSource";
  docs: DocsSlug;
  /** Kommandoer at kopiere; ellers en knap (deploy) eller kun docs-linket. */
  command?: string;
  deployUrl?: string;
};

/**
 * De otte installationsmåder. Kommandoerne er kode og oversættes ikke.
 * Railway har ingen knap, før der findes en publiceret skabelon (se
 * docs/research/2026-11-09-timewren-landing-audit.md, fund 20).
 */
export const INSTALL_METHODS: readonly InstallMethod[] = [
  { key: "quick", docs: "install/quick", command: INSTALL_ONE_LINER },
  {
    key: "dockerCompose",
    docs: "install/docker-compose",
    command: `${ENV_SETUP}\ndocker compose up -d`,
  },
  { key: "coolify", docs: "install/coolify" },
  { key: "dokploy", docs: "install/dokploy" },
  { key: "railway", docs: "install/railway" },
  {
    key: "render",
    docs: "install/render",
    deployUrl: `https://render.com/deploy?repo=${REPO}`,
  },
  {
    key: "kubernetes",
    docs: "install/kubernetes",
    command: `git clone ${REPO}.git && cd timewren\nhelm install timewren ./charts/timewren \\\n  --namespace timewren --create-namespace`,
  },
  {
    key: "fromSource",
    docs: "install/from-source",
    // docker-compose.yml bruger ghcr.io/timewren/timewren:${TIMEWREN_VERSION},
    // så et lokalt bygget image med tagget "local" tages i brug i stedet
    // for det færdige. Build-args skal blot være ikke-tomme (som i compose).
    command: [
      ENV_SETUP,
      "echo TIMEWREN_VERSION=local >> .env",
      "docker build -t ghcr.io/timewren/timewren:local \\",
      "  --build-arg BETTER_AUTH_SECRET=build-time-placeholder \\",
      "  --build-arg DATABASE_URL=postgresql://build:build@localhost:5432/build .",
      "docker compose up -d",
    ].join("\n"),
  },
];

/** Screenshot-navne fra kontrakten: public/brand/timewren/screens/<locale>/<navn>.webp */
export const SCREEN_NAMES = [
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
] as const;
export type ScreenName = (typeof SCREEN_NAMES)[number];

export const SCREENS_DIR = "/brand/timewren/screens";

/**
 * Midlertidige filer fra før screenshots pr. sprog (dansk UI). Bruges kun,
 * når hverken sprogets eller den engelske fil findes, så siden aldrig viser
 * et ødelagt billede. Fjernes ved samlingen sammen med filerne.
 */
const LEGACY_SCREENS: Partial<Record<ScreenName, string>> = {
  dashboard: `${SCREENS_DIR}/dashboard.webp`,
  timer: `${SCREENS_DIR}/dashboard.webp`,
  "prepaid-hours": `${SCREENS_DIR}/prepaid-hours.webp`,
};

/**
 * Stien til et screenshot: sprogets egen fil, ellers den engelske, ellers
 * den gamle fælles fil. null = intet billede (sektionen vises uden).
 * `exists` får den offentlige sti (/brand/…) og svarer, om filen findes.
 */
export function resolveScreen(
  name: ScreenName,
  locale: Locale,
  exists: (publicPath: string) => boolean,
): string | null {
  const candidates = [
    `${SCREENS_DIR}/${locale}/${name}.webp`,
    `${SCREENS_DIR}/${SITE_DEFAULT_LOCALE}/${name}.webp`,
    LEGACY_SCREENS[name],
  ];
  for (const c of candidates) if (c && exists(c)) return c;
  return null;
}

/**
 * Bredde og højde fra en webp-fils header (VP8, VP8L eller VP8X), så
 * next/image får de rigtige mål uden at gætte. null ved ukendt format.
 */
export function webpSize(
  buf: Uint8Array,
): { width: number; height: number } | null {
  const ascii = (o: number, n: number) =>
    String.fromCharCode(...buf.subarray(o, o + n));
  if (buf.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") {
    return null;
  }
  const u16 = (o: number) => buf[o] | (buf[o + 1] << 8);
  const u24 = (o: number) => buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
  const chunk = ascii(12, 4);
  if (chunk === "VP8X") {
    return { width: u24(24) + 1, height: u24(27) + 1 };
  }
  if (chunk === "VP8 ") {
    return { width: u16(26) & 0x3fff, height: u16(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const b = (o: number) => buf[21 + o];
    return {
      width: 1 + (b(0) | ((b(1) & 0x3f) << 8)),
      height: 1 + ((b(1) >> 6) | (b(2) << 2) | ((b(3) & 0x0f) << 10)),
    };
  }
  return null;
}
