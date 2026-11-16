// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EMPTY_INLINE_SCRIPT_HASH,
  REPORT_ONLY_CSP_HEADER,
  SCALAR_API_REFERENCE_SCRIPT,
} from "@/lib/security-headers";
import { GET } from "../route";

/** /api/v1/docs is outside the middleware matcher, so it sets its own (#1121). */
describe("GET /api/v1/docs: report-only CSP", () => {
  it("allows exactly the Scalar bundle the page loads", async () => {
    const res = await GET();
    const html = await res.text();
    const policy = res.headers.get(REPORT_ONLY_CSP_HEADER) ?? "";

    const scriptSrcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(scriptSrcs).toEqual([SCALAR_API_REFERENCE_SCRIPT]);
    expect(policy).toContain(SCALAR_API_REFERENCE_SCRIPT);
    expect(policy).not.toMatch(/https:\/\/cdn\.jsdelivr\.net[ ;]/);
  });

  it("allows the empty config script by hash", async () => {
    const res = await GET();
    const html = await res.text();
    const inline = [
      ...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g),
    ].map((m) => m[1]);
    expect(inline.length).toBeGreaterThan(0);
    for (const body of inline) {
      expect(
        `sha256-${createHash("sha256").update(body).digest("base64")}`,
      ).toBe(EMPTY_INLINE_SCRIPT_HASH);
    }
    expect(res.headers.get(REPORT_ONLY_CSP_HEADER)).toContain(
      `'${EMPTY_INLINE_SCRIPT_HASH}'`,
    );
  });

  it("does not set the enforced policy itself", async () => {
    const res = await GET();
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});
