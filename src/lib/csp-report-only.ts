/**
 * Report-only CSP per request (#1121, docs/security/csp.md).
 *
 * The middleware calls withReportOnlyCsp() on every page response. It makes a
 * fresh nonce, sends the stricter policy as Content-Security-Policy-Report-Only
 * and passes the same policy on as a request header, which is where Next.js
 * reads the nonce for its own inline scripts (parse-request-headers.js reads
 * `content-security-policy`, then `content-security-policy-report-only`).
 *
 * The enforced Content-Security-Policy still comes from next.config.ts and is
 * not touched here. No dependencies beyond the edge-safe modules, so it runs
 * in middleware.
 */

import type { NextRequest, NextResponse } from "next/server";
import { appUrlEnv, marketingUrlEnv } from "@/lib/runtime-env";
import {
  buildReportOnlyContentSecurityPolicy,
  originOf,
  REPORT_ONLY_CSP_HEADER,
  type ReportOnlyCspOptions,
} from "@/lib/security-headers";

const REQUEST_HEADER = REPORT_ONLY_CSP_HEADER.toLowerCase();
const OVERRIDE_HEADERS = "x-middleware-override-headers";
const REQUEST_HEADER_PREFIX = "x-middleware-request-";

/** Read at call time with a dynamic key, so Next does not inline it. */
function runtimeEnv(name: string): string | undefined {
  return process.env[name];
}

/** Base64 of a random UUID (122 bits), as in the Next.js CSP guide. */
export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

/** The report-only policy with the same env inputs as the enforced one. */
export function reportOnlyCspFromEnv(
  extra: Pick<ReportOnlyCspOptions, "nonce" | "scalarApiReference"> = {},
): string {
  return buildReportOnlyContentSecurityPolicy({
    isDevelopment: process.env.NODE_ENV === "development",
    marketingOrigin: originOf(
      marketingUrlEnv(),
      appUrlEnv() ?? "http://localhost:3000",
    ),
    plausibleOrigin: originOf(process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL, ""),
    storageOrigin: originOf(runtimeEnv("S3_ENDPOINT"), ""),
    ...extra,
  });
}

/**
 * Adds one request header to a middleware response, the same way
 * NextResponse.next({ request: { headers } }) does it. Responses that already
 * override the request headers (x-brand, x-brand-locale) keep their list.
 */
function setRequestHeader(
  req: NextRequest,
  res: NextResponse,
  name: string,
  value: string,
): void {
  const existing = res.headers.get(OVERRIDE_HEADERS);
  const keys = existing ? existing.split(",") : [];
  if (!existing) {
    req.headers.forEach((v, key) => {
      keys.push(key);
      res.headers.set(`${REQUEST_HEADER_PREFIX}${key}`, v);
    });
  }
  if (!keys.includes(name)) keys.push(name);
  res.headers.set(OVERRIDE_HEADERS, keys.join(","));
  res.headers.set(`${REQUEST_HEADER_PREFIX}${name}`, value);
}

/**
 * Adds the report-only policy to responses that render a page (next or
 * rewrite). Redirects and the middleware's own plain responses are returned
 * unchanged.
 */
export function withReportOnlyCsp(
  req: NextRequest,
  res: NextResponse,
): NextResponse {
  const rendersPage =
    res.headers.has("x-middleware-next") ||
    res.headers.has("x-middleware-rewrite");
  if (!rendersPage) return res;

  const policy = reportOnlyCspFromEnv({ nonce: createNonce() });
  res.headers.set(REPORT_ONLY_CSP_HEADER, policy);
  setRequestHeader(req, res, REQUEST_HEADER, policy);
  return res;
}
