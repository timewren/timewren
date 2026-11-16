/**
 * Content-Security-Policy for all pages (see next.config.ts headers()).
 *
 * Kept as a pure function so the production header can be regression-tested
 * without importing next.config.ts (which pulls in Sentry and next-intl).
 */

/**
 * Hosts that gtag.js for a Google Ads (AW-) property actually contacts, per
 * Google's CSP guide for Ads conversion tracking. Kept minimal: no GA4
 * (google-analytics.com) since no GA property is configured, and no
 * remarketing frames (td.doubleclick.net).
 */
export const GOOGLE_ADS_SCRIPT_SOURCES = [
  "https://www.googletagmanager.com",
  "https://www.googleadservices.com",
  "https://googleads.g.doubleclick.net",
] as const;

export const GOOGLE_ADS_CONNECT_SOURCES = [
  "https://www.googletagmanager.com",
  "https://www.google.com",
  "https://googleads.g.doubleclick.net",
  // Conversion Linker-pinget (ccm/collect) går til pagead2, ikke til
  // googleads.g.doubleclick.net (QA-fund #7).
  "https://pagead2.googlesyndication.com",
] as const;

export interface CspOptions {
  /** Adds 'unsafe-eval' to script-src (needed for React Fast Refresh). */
  isDevelopment: boolean;
  /**
   * Origin of the marketing host (e.g. https://timetrack.dk). Marketing paths
   * requested on the app host are redirected there by the middleware, so
   * client-side prefetches (e.g. the /cookies link) must be allowed in
   * connect-src or the browser blocks the redirected fetch.
   */
  marketingOrigin: string;
  /**
   * Origin of the Plausible host (from NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL). Left
   * out of the policy when analytics isn't configured.
   */
  plausibleOrigin?: string;
}

export function buildContentSecurityPolicy({
  isDevelopment,
  marketingOrigin,
  plausibleOrigin,
}: CspOptions): string {
  const scriptSrc = [
    "'self'",
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    ...(plausibleOrigin ? [plausibleOrigin] : []),
    "https://cdn.jsdelivr.net",
    ...GOOGLE_ADS_SCRIPT_SOURCES,
  ];

  const connectSrc = [
    "'self'",
    "https://api.resend.com",
    "https://distribution.virk.dk",
    // useLatestDesktopRelease (dashboard Desktop-kort/indstillinger) henter
    // seneste release direkte fra den offentlige GitHub API i browseren.
    "https://api.github.com",
    ...(plausibleOrigin ? [plausibleOrigin] : []),
    "https://*.sentry.io",
    "https://*.ingest.sentry.io",
    "https://fejlspor.mahoje.dk",
    "https://fonts.gstatic.com",
    ...GOOGLE_ADS_CONNECT_SOURCES,
    marketingOrigin,
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join("; ");
}

/** Origin (scheme + host) of a URL, or the fallback when unset/invalid. */
export function originOf(url: string | undefined, fallback: string): string {
  if (!url) return fallback;
  try {
    return new URL(url).origin;
  } catch {
    return fallback;
  }
}

/**
 * Stricter policy sent as Content-Security-Policy-Report-Only next to the
 * enforced one (#1121, docs/security/csp.md). The browser only reports
 * violations to CSP_REPORT_PATH; nothing is blocked. Flip it to enforced once
 * the reports are quiet.
 */
export const CSP_REPORT_PATH = "/api/csp-report";

/** Response header carrying the stricter, non-enforced policy. */
export const REPORT_ONLY_CSP_HEADER = "Content-Security-Policy-Report-Only";

/**
 * The only current jsdelivr use: the Scalar bundle on /api/v1/docs
 * (src/app/api/v1/docs/route.ts). Pinned to the exact file, so the
 * report-only policy does not allow the rest of the CDN.
 */
export const SCALAR_API_REFERENCE_SCRIPT =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.51.0";

/**
 * Hash of an empty inline script. /api/v1/docs carries its config in an empty
 * <script id="api-reference" data-…> element, which CSP treats as inline.
 */
export const EMPTY_INLINE_SCRIPT_HASH =
  "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";

/**
 * OAuth avatars rendered straight from the provider URL (user.image). Same
 * hosts as images.remotePatterns in next.config.ts.
 */
export const OAUTH_AVATAR_IMG_SOURCES = [
  "https://lh3.googleusercontent.com",
  "https://avatars.githubusercontent.com",
  "https://cdn.discordapp.com",
] as const;

/** Image pings from gtag.js (conversions, Conversion Linker). */
export const GOOGLE_ADS_IMG_SOURCES = [
  "https://www.googletagmanager.com",
  "https://www.google.com",
  "https://www.google.dk",
  "https://googleads.g.doubleclick.net",
] as const;

export interface ReportOnlyCspOptions extends CspOptions {
  /** Per-request nonce; Next.js adds it to its own inline scripts. */
  nonce?: string;
  /** Origin of S3_ENDPOINT (public uploads such as logos and attachments). */
  storageOrigin?: string;
  /** Allows the pinned Scalar bundle (only /api/v1/docs sets this). */
  scalarApiReference?: boolean;
}

export function buildReportOnlyContentSecurityPolicy({
  isDevelopment,
  marketingOrigin,
  plausibleOrigin,
  nonce,
  storageOrigin,
  scalarApiReference,
}: ReportOnlyCspOptions): string {
  const scriptSrc = [
    "'self'",
    ...(nonce ? [`'nonce-${nonce}'`] : []),
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
    "'wasm-unsafe-eval'",
    ...(plausibleOrigin ? [plausibleOrigin] : []),
    ...(scalarApiReference
      ? [`'${EMPTY_INLINE_SCRIPT_HASH}'`, SCALAR_API_REFERENCE_SCRIPT]
      : []),
    ...GOOGLE_ADS_SCRIPT_SOURCES,
  ];

  const imgSrc = [
    "'self'",
    "data:",
    "blob:",
    ...(storageOrigin ? [storageOrigin] : []),
    ...OAUTH_AVATAR_IMG_SOURCES,
    ...GOOGLE_ADS_IMG_SOURCES,
  ];

  // Everything except script-src, style-src, img-src and font-src is shared
  // with the enforced policy, so the two cannot drift apart.
  const shared = buildContentSecurityPolicy({
    isDevelopment,
    marketingOrigin,
    plausibleOrigin,
  })
    .split("; ")
    .filter(
      (d) =>
        !/^(script-src|style-src|img-src|font-src) /.test(d) &&
        !d.startsWith("default-src "),
    );

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(" ")}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    ...shared,
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}
