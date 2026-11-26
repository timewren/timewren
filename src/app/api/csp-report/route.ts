import { type NextRequest, NextResponse } from "next/server";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";
import { type RawReport, summarizeReport } from "./summarize-report";

/**
 * Receiver for the report-only Content-Security-Policy (#1121,
 * docs/security/csp.md). Browsers post here without cookies or login, so the
 * route is public and rate-limited per IP.
 *
 * Only the directive and the blocked host are logged. Reports also carry the
 * page URL, referrer, script samples and the full blocked URL, which can hold
 * ids, tokens or user data; those fields are never read.
 */

const MAX_BODY_BYTES = 64 * 1024;
/** Max reports logged from one Reporting API batch. */
const MAX_REPORTS_PER_BATCH = 20;

/** Both formats: report-uri ({"csp-report": …}) and Reporting API ([…]). */
function extractReports(payload: unknown): RawReport[] | null {
  if (Array.isArray(payload)) {
    return payload
      .filter(
        (entry): entry is { type: unknown; body: RawReport } =>
          !!entry &&
          typeof entry === "object" &&
          entry.type === "csp-violation" &&
          !!entry.body &&
          typeof entry.body === "object",
      )
      .slice(0, MAX_REPORTS_PER_BATCH)
      .map((entry) => entry.body);
  }
  if (payload && typeof payload === "object" && "csp-report" in payload) {
    const report = (payload as Record<string, unknown>)["csp-report"];
    if (report && typeof report === "object") return [report as RawReport];
  }
  return null;
}

/**
 * Body as text, or null once it passes maxBytes. Reads the stream in bytes and
 * cancels it at the limit, so a chunked body without Content-Length is never
 * buffered in full.
 */
async function readBodyWithLimit(
  request: NextRequest,
  maxBytes: number,
): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Did the client drop the upload (tab closed, navigation)? Node rejects the
 * body stream with "aborted"/ECONNRESET (Sentry TIMETRACK-2A); fetch-style
 * streams use AbortError. Anything else is a real bug and must reach Sentry.
 */
function isAbortedUpload(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: unknown }).code;
  return (
    err.message === "aborted" ||
    err.name === "AbortError" ||
    err.name === "ResponseAborted" ||
    code === "ECONNRESET" ||
    code === "ERR_STREAM_PREMATURE_CLOSE"
  );
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rateCheck = await rateLimiter.check(
    ipRateLimitKey(ip, "cspReport"),
    "cspReport",
  );
  if (!rateCheck.allowed) {
    return new NextResponse(null, { status: 429 });
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }
  let text: string | null;
  try {
    text = await readBodyWithLimit(request, MAX_BODY_BYTES);
  } catch (err) {
    // The browser dropped the upload: nobody is listening for the answer,
    // and a lost report is not a server error.
    if (isAbortedUpload(err)) return new NextResponse(null, { status: 204 });
    throw err;
  }
  if (text === null) {
    return new NextResponse(null, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const reports = extractReports(payload);
  if (!reports) {
    return new NextResponse(null, { status: 400 });
  }

  for (const report of reports) {
    console.warn("[csp-report]", summarizeReport(report));
  }
  return new NextResponse(null, { status: 204 });
}
