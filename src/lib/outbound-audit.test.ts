import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Revision af udgående kald (#1024): en selvhostet instans med tomt miljø må
 * ikke kalde Mahope (mahoje.dk, mahope.dk, timetrack.dk, timewren.*) eller
 * Mahopes konti hos tredjepart (Google Ads).
 *
 * Kald (data forlader instansen) er noget andet end links i tekst: links er
 * ikke omfattet. Den fulde kortlægning står i PR-beskrivelsen.
 */

const MAHOPE_HOST =
  /(^|\.)(mahoje\.dk|mahope\.dk|timetrack\.dk|timewren\.[a-z]+)$/;

function hostOf(input: unknown): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;
  return new URL(raw).hostname;
}

/** Miljøet en selvhoster har, før nogen har sat noget. */
const SELFHOST_ENV_UNSET = [
  "NEXT_PUBLIC_BRAND",
  "NEXT_PUBLIC_GOOGLE_ADS_ID",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL",
  "PLAUSIBLE_API_KEY",
  "PLAUSIBLE_SITE_ID",
  "PLAUSIBLE_BASE_URL",
  "CVR_SERVICE_API_KEY",
  "CVR_SERVICE_URL",
  "ALUNTA_API_KEY",
  "SENTRY_ACCESS_TOKEN",
  "SENTRY_AUTH_TOKEN",
  "DOKPLOY_API_URL",
  "CLAUDE_AGENT_TRIGGER_URL",
  "STORE_BILLING_ENABLED",
];

function selfhostEnv() {
  for (const key of SELFHOST_ENV_UNSET) vi.stubEnv(key, "");
}

beforeEach(() => {
  vi.resetModules();
  selfhostEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("selvhost med tomt miljø", () => {
  it("indlæser ikke gtag.js og nævner ikke Mahopes Google Ads-konto", async () => {
    vi.doMock("next/script", () => ({
      default: (props: Record<string, unknown>) =>
        createElement("script", {
          src: props.src as string | undefined,
          // biome-ignore lint/security/noDangerouslySetInnerHtml: next/script-mock gengiver testens egne scriptbørn
          dangerouslySetInnerHTML: props.children
            ? { __html: String(props.children) }
            : undefined,
        }),
    }));
    const { GoogleAds, trackGoogleConversion } = await import(
      "@/components/GoogleAds"
    );
    const html = renderToStaticMarkup(createElement(GoogleAds));
    expect(html).toBe("");
    expect(html).not.toContain("googletagmanager");
    expect(html).not.toContain("AW-");

    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag });
    trackGoogleConversion("signup");
    expect(gtag).not.toHaveBeenCalled();
  });

  it("indlæser gtag.js for Cloud (NEXT_PUBLIC_BRAND=timetrack) som hidtil", async () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    vi.doMock("next/script", () => ({
      default: (props: Record<string, unknown>) =>
        createElement("script", { src: props.src as string | undefined }),
    }));
    const { GoogleAds } = await import("@/components/GoogleAds");
    const html = renderToStaticMarkup(createElement(GoogleAds));
    expect(html).toContain(
      "https://www.googletagmanager.com/gtag/js?id=AW-18183663242",
    );
  });

  it("bruger selvhosterens eget Google Ads-id, når det er sat", async () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_ADS_ID", "AW-1234");
    const { getGoogleAdsId } = await import("@/lib/google-ads");
    expect(getGoogleAdsId()).toBe("AW-1234");
  });

  it("mails har intet portræt hostet hos Mahope", async () => {
    const { MAIL_AVATAR_URL, MAIL_LOGO_URL } = await import(
      "@/components/email/brand"
    );
    expect(MAIL_AVATAR_URL).toBeUndefined();
    expect(new URL(MAIL_LOGO_URL, "http://localhost").hostname).not.toMatch(
      MAHOPE_HOST,
    );
  });

  it("Cloud-mails beholder portrættet på timetrack.dk", async () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    const { MAIL_AVATAR_URL } = await import("@/components/email/brand");
    expect(MAIL_AVATAR_URL).toBe("https://timetrack.dk/brand/mads-128.jpg");
  });

  it("Sentry initialiseres uden DSN (server og edge), så intet sendes", async () => {
    const init = vi.fn();
    vi.doMock("@sentry/nextjs", () => ({ init, captureRequestError: vi.fn() }));
    await import("../../sentry.server.config");
    await import("../../sentry.edge.config");
    expect(init).toHaveBeenCalledTimes(2);
    for (const [options] of init.mock.calls) {
      expect(options.dsn).toBeFalsy();
    }
  });

  it("browser-Sentry er slukket uden DSN", async () => {
    const ctor = vi.fn();
    vi.stubGlobal("window", {
      location: { hostname: "localhost", origin: "http://localhost" },
    });
    vi.doMock("@sentry/browser", () => ({
      BrowserClient: class {
        constructor(options: unknown) {
          ctor(options);
        }
        init() {}
      },
      dedupeIntegration: () => ({}),
      defaultStackParser: () => [],
      getCurrentScope: () => ({ setClient: () => {} }),
      globalHandlersIntegration: () => ({}),
      httpContextIntegration: () => ({}),
      linkedErrorsIntegration: () => ({}),
      makeFetchTransport: () => ({}),
    }));
    vi.doMock("@/lib/pwa/stale-build", () => ({
      hardNavigateIfStale: vi.fn(),
    }));
    await import("../instrumentation-client");
    expect(ctor).toHaveBeenCalledTimes(1);
    const [options] = ctor.mock.calls[0];
    expect(options.dsn).toBeFalsy();
    expect(options.enabled).toBe(false);
  });

  it("Plausible er slukket og laver ingen kald", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { isPlausibleConfigured } = await import("@/lib/plausible");
    expect(isPlausibleConfigured()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("CVR-opslag rammer ikke Mahopes CVR-tjeneste uden nøgle", async () => {
    const hosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        hosts.push(hostOf(input));
        return new Response(JSON.stringify({ error: "NOT_FOUND" }), {
          status: 404,
        });
      }),
    );
    const { lookupCVR } = await import("@/lib/integrations/cvr");
    await lookupCVR("12345678").catch(() => null);
    for (const host of hosts) expect(host).not.toMatch(MAHOPE_HOST);
  });
});

/**
 * Statisk vagt: ingen fast Mahope-adresse som mål for et kald (`fetch(`,
 * `new URL(`, `sendBeacon(`) eller som `src` til et eksternt script. Links i
 * tekst og mails er bevidst undtaget.
 *
 * Vagten kigger på kaldet og de næste linjer (multi-line, template literals og
 * `??`-fallbacks), og på konstanter med en Mahope-adresse som bruges i et kald i
 * samme fil. Den er en statisk grænse, ikke et bevis: et reelt gennemløb
 * (registrering, kunde, tid, faktura-kladde) med lukket netværk kræver
 * PostgreSQL og hører til `npm run test:e2e`.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

const HOSTS =
  "(?:mahoje\\.dk|mahope\\.dk|timetrack\\.dk|timewren\\.|googletagmanager\\.com)";
const MAHOPE_URL = new RegExp(`https?://[^\\s"'\`]*${HOSTS}`);
const CALL_START = /(fetch\(|new URL\(|sendBeacon\(|<Script\b|<script\b)/;
const WINDOW_LINES = 4;

function findOutboundHits(text: string): number[] {
  const lines = text.split("\n");
  const hits = new Set<number>();

  // Konstanter med fast Mahope-adresse (også på en anden linje end kaldet).
  const constants: string[] = [];
  for (const line of lines) {
    const m = line.match(
      new RegExp(
        `(?:const|let|var)\\s+(\\w+)\\s*=\\s*[\`"']https?://[^\`"']*${HOSTS}`,
      ),
    );
    if (m) constants.push(m[1]);
  }

  lines.forEach((line, i) => {
    if (!CALL_START.test(line)) return;
    const windowText = lines.slice(i, i + WINDOW_LINES).join("\n");
    // Kun fra selve kaldet og fremad, så en tidligere linje ikke tæller med.
    const fromCall = windowText.slice(windowText.search(CALL_START));
    if (MAHOPE_URL.test(fromCall)) hits.add(i);
    for (const name of constants) {
      if (new RegExp(`\\b${name}\\b`).test(fromCall)) hits.add(i);
    }
  });
  return [...hits].sort((a, b) => a - b);
}

/** Præcise undtagelser (fil + linjeindhold), ikke hele filer. */
const ALLOWED: Array<{ file: string; line: RegExp; why: string }> = [
  {
    file: "components/GoogleAds.tsx",
    line: /googletagmanager\.com\/gtag\/js\?id=\$\{GA_ID\}/,
    why: "gtag.js: komponenten returnerer null uden Google Ads-id (getGoogleAdsId)",
  },
  {
    file: "app/(marketing)/developers/page.tsx",
    line: /fetch\("https:\/\/timetrack\.dk\/api\/v1\/time-entries"/,
    why: "kodeeksempel i dokumentationen: tekst på siden, intet kald",
  },
];

describe("fast adresse som kaldsmål", () => {
  it("findes kun i præcist undtagne linjer", () => {
    const root = join(__dirname, "..");
    const hits: string[] = [];
    for (const file of sourceFiles(root)) {
      const rel = relative(root, file).split("\\").join("/");
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      for (const i of findOutboundHits(text)) {
        const allowed = ALLOWED.some(
          (a) =>
            a.file === rel &&
            a.line.test(lines.slice(i, i + WINDOW_LINES).join("\n")),
        );
        if (!allowed) hits.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("vagten kan fejle: fanger kald i forskellige former", () => {
    const bad = [
      'await fetch("https://timetrack.dk/api/ping")',
      '<Script src="https://www.googletagmanager.com/x" />',
      `fetch(\`\${process.env.X ?? "https://timetrack.dk"}/ping\`)`,
      'const PING = "https://api.mahoje.dk/ping";\nawait fetch(PING);',
      'await fetch(\n  "https://mahoje.dk/hook",\n  { method: "POST" },\n);',
      'const u = new URL("https://timewren.com/x");',
    ];
    for (const src of bad) expect(findOutboundHits(src), src).not.toEqual([]);
  });

  it("vagten fanger et kald i en reel kildefil", () => {
    const real = readFileSync(
      join(__dirname, "../components/GoogleAds.tsx"),
      "utf8",
    );
    expect(findOutboundHits(real)).not.toEqual([]);
    const injected = `${real}\nvoid fetch("https://timetrack.dk/ping");\n`;
    expect(findOutboundHits(injected).length).toBeGreaterThan(
      findOutboundHits(real).length,
    );
  });

  it("vagten ignorerer links i tekst", () => {
    expect(findOutboundHits('<a href="https://timetrack.dk/terms">')).toEqual(
      [],
    );
    expect(
      findOutboundHits('const url = "https://timetrack.dk/blog";'),
    ).toEqual([]);
  });
});
