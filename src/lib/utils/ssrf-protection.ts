/**
 * SSRF Protection Utility
 *
 * Validates URLs and hostnames to prevent Server-Side Request Forgery attacks.
 * Blocks connections to internal/private networks and cloud metadata endpoints.
 *
 * Note: DNS resolution check mitigates DNS rebinding attacks but a TOCTOU
 * window still exists. For full protection, a custom HTTP agent with
 * connect-time IP validation would be needed.
 */

import dns from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]);

/**
 * Check if an IP address is in a private/reserved range
 */
function isPrivateIP(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;

  const [a, b] = parts;

  return (
    a === 0 || // 0.0.0.0/8 (current network)
    a === 10 || // 10.0.0.0/8 (private)
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT)
    a === 127 || // 127.0.0.0/8 (loopback)
    (a === 169 && b === 254) || // 169.254.0.0/16 (link-local / cloud metadata)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 (private)
    (a === 192 && b === 168) || // 192.168.0.0/16 (private)
    a === 255 // 255.255.255.255 (broadcast)
  );
}

/**
 * Check if an IPv6 address is private/loopback
 */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4-mapped IPv6 — vurdér den indlejrede IPv4, ellers kan loopback/
  // private ranges smugles forbi IPv4-checket. Formen afhænger af Node-
  // versionens URL-parser: dotted (::ffff:127.0.0.1) ELLER hex
  // (::ffff:7f00:1) — begge skal fanges.
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (mapped.includes(".")) {
      return isPrivateIP(mapped);
    }
    // Hex-form: én eller to hex-grupper der tilsammen er de 32 IPv4-bit
    // (fx "7f00:1" = 127.0.0.1, "a00:1" = 10.0.0.1, "1" = 0.0.0.1).
    const groups = mapped.split(":");
    if (groups.length <= 2 && groups.every((g) => /^[0-9a-f]{0,4}$/.test(g))) {
      const high = groups.length === 2 ? parseInt(groups[0] || "0", 16) : 0;
      const low = parseInt(groups[groups.length - 1] || "0", 16);
      const dotted = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
      return isPrivateIP(dotted);
    }
  }

  return (
    normalized === "::1" ||
    normalized === "::" || // unspecified
    normalized.startsWith("fe80:") || // link-local
    normalized.startsWith("fc") || // unique local (fc00::/7)
    normalized.startsWith("fd") // unique local (fc00::/7)
  );
}

/**
 * Resolve hostname and check if it points to a private IP.
 * Returns an error message if private, or null if safe.
 */
async function checkResolvedIP(
  hostname: string,
  rejectOnDnsFailure = false,
): Promise<string | null> {
  // IP-literaler (også IPv6 i klammer) er allerede vurderet direkte af
  // kalderen; der er intet navn at slå op.
  if (isIP(hostname.replace(/^\[|\]$/g, ""))) return null;

  try {
    // Resolve all addresses (both IPv4 and IPv6)
    const results = await dns.lookup(hostname, { all: true });

    for (const result of results) {
      if (result.family === 4 && isPrivateIP(result.address)) {
        return "URL resolver til en intern adresse";
      }
      if (result.family === 6 && isPrivateIPv6(result.address)) {
        return "URL resolver til en intern adresse";
      }
    }
  } catch {
    // DNS-opslaget fejlede. Kaldere der selv sender requesten straks efter
    // (webhook-levering, #1111) afviser (fail closed), så et senere rebound
    // navn ikke slipper igennem. Øvrige kaldere (fx validering ved gem)
    // lader som før fejlen håndtere nedstrøms.
    return rejectOnDnsFailure ? "URL kunne ikke resolves" : null;
  }

  return null;
}

/**
 * Validate a URL to ensure it doesn't point to internal/private services.
 * Performs both hostname check and DNS resolution check.
 * Returns an error message if the URL is blocked, or null if it's safe.
 */
export async function validateUrlForSSRF(
  urlString: string,
  options: { rejectOnDnsFailure?: boolean } = {},
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return "Ugyldig URL";
  }

  // Must be HTTPS
  if (parsed.protocol !== "https:") {
    return "URL skal bruge HTTPS";
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known internal hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return "URL peger på en intern adresse";
  }

  // Block IP addresses in private ranges
  if (isPrivateIP(hostname)) {
    return "URL peger på en intern adresse";
  }

  // Block IPv6 loopback
  if (isPrivateIPv6(hostname)) {
    return "URL peger på en intern adresse";
  }

  // Resolve DNS and check resolved IP against private ranges
  const dnsError = await checkResolvedIP(
    hostname,
    options.rejectOnDnsFailure ?? false,
  );
  if (dnsError) {
    return dnsError;
  }

  return null;
}

/**
 * Validate a hostname (without protocol) to ensure it doesn't point to internal services.
 * Used for IMAP/SMTP server validation. Performs DNS resolution check.
 * Returns an error message if the hostname is blocked, or null if it's safe.
 */
export async function validateHostnameForSSRF(
  hostname: string,
): Promise<string | null> {
  const normalized = hostname.toLowerCase().trim();

  // Block known internal hostnames
  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return "Hostname peger på en intern adresse";
  }

  // Block IP addresses in private ranges
  if (isPrivateIP(normalized)) {
    return "Hostname peger på en intern adresse";
  }

  // Block IPv6 loopback
  if (isPrivateIPv6(normalized)) {
    return "Hostname peger på en intern adresse";
  }

  // Resolve DNS and check resolved IP
  const dnsError = await checkResolvedIP(normalized);
  if (dnsError) {
    return dnsError;
  }

  return null;
}
