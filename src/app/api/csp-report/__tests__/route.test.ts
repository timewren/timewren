// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RATE_LIMIT_CONFIGS } from "@/lib/utils/rate-limiter";
import { POST } from "../route";
import { summarizeReport } from "../summarize-report";

/**
 * /api/csp-report (#1121): accepts reports without login, logs only the
 * directive and the blocked host at warn level, and rate-limits per IP.
 */

let ipCounter = 0;
let ip = "";

function post(body: unknown, contentType = "application/csp-report") {
  return new NextRequest("https://timetrack.dk/api/csp-report", {
    method: "POST",
    headers: { "content-type": contentType, "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** POST with a streamed body, so no Content-Length header is set. */
function chunked(body: Uint8Array[] | ReadableStream<Uint8Array>) {
  const stream =
    body instanceof ReadableStream
      ? body
      : new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of body) controller.enqueue(chunk);
            controller.close();
          },
        });
  return new NextRequest("https://timetrack.dk/api/csp-report", {
    method: "POST",
    headers: {
      "content-type": "application/csp-report",
      "x-forwarded-for": ip,
    },
    body: stream,
    duplex: "half",
  } as ConstructorParameters<typeof NextRequest>[1]);
}

const LEGACY_REPORT = {
  "csp-report": {
    "document-uri": "https://timetrack.dk/dashboard/clients/42?token=secret",
    referrer: "https://timetrack.dk/dashboard",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "default-src 'self'",
    "blocked-uri": "https://evil.example.com/path/x.js?user=anna@example.com",
    "script-sample": "alert('anna@example.com')",
    "source-file": "https://timetrack.dk/dashboard",
  },
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ipCounter += 1;
  ip = `203.0.113.${ipCounter}`;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("POST /api/csp-report", () => {
  it("logs only directive and blocked host for a report-uri report", async () => {
    const res = await POST(post(LEGACY_REPORT));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls[0]);
    expect(logged).toContain("script-src-elem");
    expect(logged).toContain("evil.example.com");
    expect(logged).not.toContain("/path");
    expect(logged).not.toContain("anna@example.com");
    expect(logged).not.toContain("token=secret");
    expect(logged).not.toContain("clients/42");
  });

  it("handles Reporting API batches (application/reports+json)", async () => {
    const res = await POST(
      post(
        [
          {
            type: "csp-violation",
            url: "https://timetrack.dk/dashboard?x=1",
            body: {
              effectiveDirective: "img-src",
              blockedURL: "https://images.example.net/a.png",
              documentURL: "https://timetrack.dk/dashboard?x=1",
            },
          },
        ],
        "application/reports+json",
      ),
    );
    expect(res.status).toBe(204);
    const logged = JSON.stringify(warn.mock.calls[0]);
    expect(logged).toContain("img-src");
    expect(logged).toContain("images.example.net");
    expect(logged).not.toContain("a.png");
  });

  it("rejects garbage without logging it", async () => {
    const res = await POST(post("<script>not json"));
    expect(res.status).toBe(400);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies", async () => {
    const res = await POST(post("x".repeat(70_000)));
    expect(res.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it("counts the limit in bytes for chunked bodies without Content-Length", async () => {
    // 40,000 "ø" are about 40,000 UTF-16 units but about 80,000 UTF-8 bytes.
    const body = JSON.stringify({
      "csp-report": {
        "effective-directive": "script-src",
        "script-sample": "ø".repeat(40_000),
      },
    });
    const res = await POST(chunked([new TextEncoder().encode(body)]));
    expect(res.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops reading a chunked stream once it passes the limit", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1_000) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x78));
      },
    });
    const res = await POST(chunked(stream));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
    expect(warn).not.toHaveBeenCalled();
  });

  it("answers 204 without throwing when the browser aborts the upload", async () => {
    // Sentry TIMETRACK-2A: a tab closes mid-report and Node rejects the
    // body stream with "aborted". That is not a server error.
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        const err = new Error("aborted") as Error & { code?: string };
        err.code = "ECONNRESET";
        throw err;
      },
    });
    const res = await POST(chunked(stream));
    expect(res.status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it("still throws when reading the body fails for another reason", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new TypeError("boom");
      },
    });
    await expect(POST(chunked(stream))).rejects.toThrow("boom");
  });

  it("rate-limits per IP", async () => {
    const { maxRequests } = RATE_LIMIT_CONFIGS.cspReport;
    for (let i = 0; i < maxRequests; i++) {
      expect((await POST(post(LEGACY_REPORT))).status).toBe(204);
    }
    warn.mockClear();
    const limited = await POST(post(LEGACY_REPORT));
    expect(limited.status).toBe(429);
    expect(warn).not.toHaveBeenCalled();

    ip = "198.51.100.7";
    expect((await POST(post(LEGACY_REPORT))).status).toBe(204);
  });
});

describe("summarizeReport", () => {
  it("keeps CSP keywords instead of a host", () => {
    expect(
      summarizeReport({
        "violated-directive": "script-src-elem 'self'",
        "blocked-uri": "inline",
      }),
    ).toEqual({ directive: "script-src-elem", blocked: "inline" });
    expect(
      summarizeReport({ effectiveDirective: "script-src", blockedURL: "eval" }),
    ).toEqual({ directive: "script-src", blocked: "eval" });
  });

  it("reduces data: and blob: URLs to their scheme", () => {
    expect(
      summarizeReport({
        "effective-directive": "img-src",
        "blocked-uri": "data:image/png;base64,AAAA",
      }).blocked,
    ).toBe("data");
  });

  it("never passes unknown free text through", () => {
    const summary = summarizeReport({
      "effective-directive": "Anna Testesen <anna@example.com>",
      "blocked-uri": "anna@example.com",
    });
    expect(summary).toEqual({ directive: "unknown", blocked: "other" });
  });
});
