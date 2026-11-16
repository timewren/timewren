// @vitest-environment node
import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";
import { createNonce, withReportOnlyCsp } from "./csp-report-only";
import { REPORT_ONLY_CSP_HEADER } from "./security-headers";

const REQUEST_HEADER = "content-security-policy-report-only";

function req(url = "https://timetrack.dk/priser") {
  return new NextRequest(url, {
    headers: { host: new URL(url).host, "accept-language": "da" },
  });
}

/** x-middleware-* headers only: what Next's router reads from middleware. */
function middlewareHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    if (!key.startsWith("x-middleware-")) return;
    // The override list is a set; its order carries no meaning.
    out[key] =
      key === "x-middleware-override-headers"
        ? value.split(",").sort().join(",")
        : value;
  });
  return out;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withReportOnlyCsp (#1121)", () => {
  it("sends the report-only policy with a nonce Next.js can read", () => {
    const res = withReportOnlyCsp(req(), NextResponse.next());
    const policy = res.headers.get(REPORT_ONLY_CSP_HEADER);
    expect(policy).toBeTruthy();
    expect(res.headers.get(`x-middleware-request-${REQUEST_HEADER}`)).toBe(
      policy,
    );
    const nonce = getScriptNonceFromHeader(policy as string);
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
    expect(policy).toContain(`'nonce-${nonce}'`);
  });

  it("does not set or change the enforced Content-Security-Policy", () => {
    const res = withReportOnlyCsp(req(), NextResponse.next());
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(
      res.headers.get("x-middleware-request-content-security-policy"),
    ).toBeNull();
  });

  it("forwards request headers exactly like NextResponse.next({ request })", () => {
    const request = req();
    const res = withReportOnlyCsp(request, NextResponse.next());
    const policy = res.headers.get(REPORT_ONLY_CSP_HEADER) as string;

    const headers = new Headers(request.headers);
    headers.set(REQUEST_HEADER, policy);
    const expected = NextResponse.next({ request: { headers } });

    expect(middlewareHeaders(res)).toEqual(middlewareHeaders(expected));
  });

  it("keeps request headers a rewrite already overrides (x-brand)", () => {
    const request = req();
    const headers = new Headers(request.headers);
    headers.set("x-brand", "timewren");
    const rewrite = NextResponse.rewrite(new URL("/x", request.url), {
      request: { headers },
    });
    const res = withReportOnlyCsp(request, rewrite);

    const keys = res.headers.get("x-middleware-override-headers")?.split(",");
    expect(keys).toContain("x-brand");
    expect(keys).toContain(REQUEST_HEADER);
    expect(keys?.filter((k) => k === REQUEST_HEADER)).toHaveLength(1);
    expect(res.headers.get("x-middleware-request-x-brand")).toBe("timewren");
    expect(res.headers.get("x-middleware-rewrite")).toBe(
      "https://timetrack.dk/x",
    );
  });

  it("leaves redirects untouched", () => {
    const redirect = NextResponse.redirect("https://timetrack.dk/login", 308);
    const before = [...redirect.headers.entries()];
    const res = withReportOnlyCsp(req(), redirect);
    expect([...res.headers.entries()]).toEqual(before);
  });

  it("uses a fresh nonce per request", () => {
    expect(createNonce()).not.toBe(createNonce());
  });

  it("adds the S3_ENDPOINT origin to img-src", () => {
    vi.stubEnv("S3_ENDPOINT", "https://hel1.your-objectstorage.com");
    const res = withReportOnlyCsp(req(), NextResponse.next());
    expect(res.headers.get(REPORT_ONLY_CSP_HEADER)).toContain(
      "img-src 'self' data: blob: https://hel1.your-objectstorage.com ",
    );
  });
});

describe("middleware sends the report-only CSP on pages (#1121)", () => {
  it("adds it to a normal page on timetrack.dk", () => {
    const res = middleware(req("https://timetrack.dk/priser"));
    expect(res.headers.get(REPORT_ONLY_CSP_HEADER)).toContain("report-uri ");
  });
});
