import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  buildReportOnlyContentSecurityPolicy,
  CSP_REPORT_PATH,
  EMPTY_INLINE_SCRIPT_HASH,
  originOf,
  SCALAR_API_REFERENCE_SCRIPT,
} from "./security-headers";

const PROD = {
  isDevelopment: false,
  marketingOrigin: "https://timetrack.dk",
};

function directive(csp: string, name: string): string[] {
  const entry = csp.split("; ").find((part) => part.startsWith(`${name} `));
  if (!entry) throw new Error(`Directive ${name} missing in CSP`);
  return entry.slice(name.length + 1).split(" ");
}

describe("buildContentSecurityPolicy (issue #379)", () => {
  const csp = buildContentSecurityPolicy(PROD);

  it("allows Fejlspor and preserves Sentry SaaS connections", () => {
    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining([
        "https://fejlspor.mahoje.dk",
        "https://*.sentry.io",
        "https://*.ingest.sentry.io",
      ]),
    );
  });

  it("allows the Google Ads gtag.js script on the app host", () => {
    expect(directive(csp, "script-src")).toEqual(
      expect.arrayContaining([
        "https://www.googletagmanager.com",
        "https://www.googleadservices.com",
        "https://googleads.g.doubleclick.net",
      ]),
    );
  });

  it("allows gtag's conversion pings in connect-src", () => {
    expect(directive(csp, "connect-src")).toEqual(
      expect.arrayContaining([
        "https://www.googletagmanager.com",
        "https://www.google.com",
        "https://googleads.g.doubleclick.net",
      ]),
    );
  });

  it("allows the Conversion Linker ping (ccm/collect)", () => {
    expect(directive(csp, "connect-src")).toContain(
      "https://pagead2.googlesyndication.com",
    );
  });

  it("allows prefetches redirected to the marketing host (cookie link)", () => {
    expect(directive(csp, "connect-src")).toContain("https://timetrack.dk");
  });

  it("allows the browser-side desktop release check (useLatestDesktopRelease)", () => {
    expect(directive(csp, "connect-src")).toContain("https://api.github.com");
  });

  it("keeps the rest of the policy strict", () => {
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/\*\.google/);
  });

  it("only adds 'unsafe-eval' in development", () => {
    const dev = buildContentSecurityPolicy({ ...PROD, isDevelopment: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });
});

describe("originOf", () => {
  it("reduces a URL to its origin", () => {
    expect(originOf("https://timetrack.dk/pricing?x=1", "fb")).toBe(
      "https://timetrack.dk",
    );
  });

  it("falls back when unset or invalid", () => {
    expect(originOf(undefined, "https://timetrack.dk")).toBe(
      "https://timetrack.dk",
    );
    expect(originOf("not a url", "https://timetrack.dk")).toBe(
      "https://timetrack.dk",
    );
  });
});

describe("buildContentSecurityPolicy: Plausible via env (#964)", () => {
  it("nævner ingen analyse-vært uden plausibleOrigin", () => {
    const csp = buildContentSecurityPolicy(PROD);
    expect(csp).not.toContain("holstjensen");
  });

  it("tillader den konfigurerede Plausible-origin i script-src og connect-src", () => {
    const csp = buildContentSecurityPolicy({
      ...PROD,
      plausibleOrigin: "https://stats.example.org",
    });
    const directive = (name: string) =>
      csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
    expect(directive("script-src")).toContain("https://stats.example.org");
    expect(directive("connect-src")).toContain("https://stats.example.org");
  });
});

describe("buildContentSecurityPolicy: enforced policy unchanged (#1121)", () => {
  it("is byte-identical to the policy on main", () => {
    expect(
      buildContentSecurityPolicy({
        ...PROD,
        plausibleOrigin: "https://stats.example.org",
      }),
    ).toBe(
      "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://stats.example.org https://cdn.jsdelivr.net https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net; " +
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; " +
        "img-src 'self' data: blob: https:; " +
        "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com; " +
        "connect-src 'self' https://api.resend.com https://distribution.virk.dk https://api.github.com https://stats.example.org https://*.sentry.io https://*.ingest.sentry.io https://fejlspor.mahoje.dk https://fonts.gstatic.com https://www.googletagmanager.com https://www.google.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://timetrack.dk; " +
        "frame-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'; " +
        "frame-ancestors 'self'; form-action 'self'; base-uri 'self'",
    );
  });
});

describe("buildReportOnlyContentSecurityPolicy (#1121)", () => {
  const NONCE = "dGVzdC1ub25jZQ==";
  const csp = buildReportOnlyContentSecurityPolicy({ ...PROD, nonce: NONCE });

  it("drops 'unsafe-inline' from script-src and uses the nonce instead", () => {
    const scriptSrc = directive(csp, "script-src");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("omits the nonce source when no nonce is given", () => {
    const noNonce = buildReportOnlyContentSecurityPolicy(PROD);
    expect(directive(noNonce, "script-src").join(" ")).not.toContain("'nonce-");
  });

  it("does not allow cdn.jsdelivr.net by default", () => {
    expect(csp).not.toContain("jsdelivr");
  });

  it("pins jsdelivr to the exact Scalar bundle when the docs page opts in", () => {
    const docs = buildReportOnlyContentSecurityPolicy({
      ...PROD,
      scalarApiReference: true,
    });
    const scriptSrc = directive(docs, "script-src");
    expect(scriptSrc).toContain(SCALAR_API_REFERENCE_SCRIPT);
    expect(SCALAR_API_REFERENCE_SCRIPT).toMatch(
      /^https:\/\/cdn\.jsdelivr\.net\/npm\/@scalar\/api-reference@\d+\.\d+\.\d+$/,
    );
    expect(scriptSrc).toContain(`'${EMPTY_INLINE_SCRIPT_HASH}'`);
    expect(directive(docs, "style-src")).not.toContain(
      "https://cdn.jsdelivr.net",
    );
  });

  it("matches the hash of an empty inline script", () => {
    expect(EMPTY_INLINE_SCRIPT_HASH).toBe(
      `sha256-${createHash("sha256").update("").digest("base64")}`,
    );
  });

  it("limits img-src to self, data:, blob: and concrete hosts", () => {
    const imgSrc = directive(csp, "img-src");
    expect(imgSrc).not.toContain("https:");
    expect(imgSrc.slice(0, 3)).toEqual(["'self'", "data:", "blob:"]);
    expect(imgSrc).toEqual(
      expect.arrayContaining([
        "https://lh3.googleusercontent.com",
        "https://avatars.githubusercontent.com",
        "https://cdn.discordapp.com",
        "https://www.google.com",
        "https://googleads.g.doubleclick.net",
      ]),
    );
    for (const source of imgSrc) {
      expect(source).not.toMatch(/^https:\/\/\*/);
    }
  });

  it("adds the object storage origin to img-src when configured", () => {
    const withStorage = buildReportOnlyContentSecurityPolicy({
      ...PROD,
      storageOrigin: "https://hel1.your-objectstorage.com",
    });
    expect(directive(withStorage, "img-src")).toContain(
      "https://hel1.your-objectstorage.com",
    );
  });

  it("keeps connect-src and the strict directives from the enforced policy", () => {
    const enforced = buildContentSecurityPolicy(PROD);
    for (const name of [
      "default-src",
      "connect-src",
      "frame-src",
      "worker-src",
      "frame-ancestors",
      "form-action",
      "base-uri",
    ]) {
      expect(directive(csp, name)).toEqual(directive(enforced, name));
    }
  });

  it("reports violations to the report endpoint", () => {
    expect(directive(csp, "report-uri")).toEqual([CSP_REPORT_PATH]);
  });

  it("adds 'unsafe-eval' only in development", () => {
    const dev = buildReportOnlyContentSecurityPolicy({
      ...PROD,
      isDevelopment: true,
    });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });
});
