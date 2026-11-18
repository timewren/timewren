const KEYWORDS = new Set([
  "inline",
  "eval",
  "wasm-eval",
  "self",
  "trusted-types-policy",
  "trusted-types-sink",
]);
const SCHEMES = new Set(["data:", "blob:", "filesystem:", "about:"]);

export type RawReport = Record<string, unknown>;

interface ReportSummary {
  directive: string;
  blocked: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function directiveOf(report: RawReport): string {
  const raw =
    str(report["effective-directive"]) ||
    str(report.effectiveDirective) ||
    str(report["violated-directive"]) ||
    str(report.violatedDirective);
  const name = raw.trim().split(/\s+/)[0] ?? "";
  return /^[a-z-]{1,40}$/.test(name) ? name : "unknown";
}

function blockedOf(report: RawReport): string {
  const raw = (str(report["blocked-uri"]) || str(report.blockedURL)).trim();
  if (KEYWORDS.has(raw)) return raw;
  try {
    const url = new URL(raw);
    if (SCHEMES.has(url.protocol)) return url.protocol.slice(0, -1);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i.test(url.host)
        ? url.host
        : "other";
    }
  } catch {
    // Not a URL: fall through.
  }
  return "other";
}

/** Directive and blocked host (or CSP keyword) from one violation report. */
export function summarizeReport(report: RawReport): ReportSummary {
  return { directive: directiveOf(report), blocked: blockedOf(report) };
}
