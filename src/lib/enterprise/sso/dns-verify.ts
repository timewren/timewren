import { randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import { tr } from "@/i18n/server-text";

/**
 * DNS TXT-verifikation af domæneejerskab (E12, #470).
 *
 * Admin opretter en TXT-record `timetrack-verify=<token>` på domænet selv
 * eller på `_timetrack-verify.<domæne>`. Vi slår begge op server-side.
 */

export const VERIFY_PREFIX = "timetrack-verify=";
export const VERIFY_SUBDOMAIN = "_timetrack-verify";

export function generateVerificationToken(): string {
  return randomBytes(16).toString("hex");
}

export function buildVerificationRecord(token: string): string {
  return `${VERIFY_PREFIX}${token}`;
}

/** Hostnames vi slår TXT op på, i prioriteret rækkefølge. */
export function verificationHostnames(domain: string): string[] {
  return [`${VERIFY_SUBDOMAIN}.${domain}`, domain];
}

/**
 * Matcher en liste TXT-records (hver record = array af chunks som
 * dns.resolveTxt returnerer) mod den forventede værdi. Chunks samles,
 * whitespace og omkransende anførselstegn ignoreres; sammenligning er
 * eksakt på token (case-sensitivt — token er hex-lowercase).
 */
export function txtRecordsContainToken(
  records: readonly (readonly string[])[],
  token: string,
): boolean {
  if (!token) return false;
  const expected = buildVerificationRecord(token);
  for (const chunks of records) {
    const joined = chunks.join("").trim().replace(/^"|"$/g, "").trim();
    if (joined === expected) return true;
  }
  return false;
}

export type TxtResolver = (hostname: string) => Promise<string[][]>;

export interface DomainVerificationResult {
  ok: boolean;
  /** Hostname hvor recorden blev fundet */
  foundOn?: string;
  /** Fejlbesked til admin (dansk) når ok=false */
  error?: string;
  /**
   * true = DNS-opslaget fejlede (netværk/timeout) — resultatet siger intet om
   * recorden. false = definitivt ingen record. Bruges til at undgå at
   * nedgradere et verificeret domæne på en transient fejl.
   */
  transient?: boolean;
}

function isNotFoundError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "ENOTFOUND" || code === "ENODATA";
}

/**
 * Slår TXT op på `_timetrack-verify.<domain>` og `<domain>` og tjekker for
 * tokenet. Resolver kan injiceres (tests). Netværksfejl rapporteres som
 * ikke-verificeret med forklaring — aldrig som verificeret.
 */
function defaultResolver(): TxtResolver {
  // Egen resolver med kort timeout så et hængende DNS-opslag ikke binder
  // request-tråden (default er ~5 s x 4 forsøg).
  const resolver = new dns.Resolver({ timeout: 3000, tries: 2 });
  return (h) => resolver.resolveTxt(h);
}

export async function verifyDomainTxt(
  domain: string,
  token: string,
  resolveTxt: TxtResolver = defaultResolver(),
): Promise<DomainVerificationResult> {
  let lastError: string | null = null;
  for (const host of verificationHostnames(domain)) {
    try {
      const records = await resolveTxt(host);
      if (txtRecordsContainToken(records, token)) {
        return { ok: true, foundOn: host };
      }
    } catch (err) {
      if (!isNotFoundError(err)) {
        lastError =
          err instanceof Error
            ? err.message
            : await tr("serverErrors", "enterprise.dns.unknown");
      }
    }
  }
  return {
    ok: false,
    transient: lastError !== null,
    error: lastError
      ? await tr("serverErrors", "enterprise.dns.lookupFailed", {
          error: lastError,
        })
      : await tr("serverErrors", "enterprise.dns.noRecord", {
          record: buildVerificationRecord(token),
          hosts: verificationHostnames(domain).join(" / "),
        }),
  };
}
