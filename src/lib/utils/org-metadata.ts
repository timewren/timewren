/**
 * Organization metadata helpers.
 *
 * Better-Auth stores `organizations.metadata` as a JSON STRING (not a jsonb
 * object), so reading it back gives a string that callers must parse before
 * accessing fields like `allowedDomains`. Spreading that string into an object
 * (`{ ...metadata }`) silently corrupts it into `{0:'{',1:'"',…}`, which is how
 * the allowed-domains setting kept getting wiped. These helpers parse
 * defensively so both the object and string forms work.
 */

export type OrgMetadata = {
  allowedDomains?: string[];
  type?: string;
  /** When true, org members only see clients they've been explicitly granted. */
  restrictClientAccess?: boolean;
  [key: string]: unknown;
};

/** Parse org metadata whether it's a string, object, or null. Never throws. */
export function parseOrgMetadata(metadata: unknown): OrgMetadata {
  if (!metadata) return {};
  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);
      return parsed && typeof parsed === "object"
        ? (parsed as OrgMetadata)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof metadata === "object") return metadata as OrgMetadata;
  return {};
}

/** Lowercased, trimmed allowed domains for an org (empty if none configured). */
export function getAllowedDomains(metadata: unknown): string[] {
  const list = parseOrgMetadata(metadata).allowedDomains;
  if (!Array.isArray(list)) return [];
  return list
    .map((d) => String(d).trim().toLowerCase())
    .filter((d) => d.length > 0);
}

/**
 * Whether an email's domain is allowed for an org. Returns true when no
 * whitelist is configured. Case-insensitive on both sides.
 */
export function isEmailDomainAllowed(
  metadata: unknown,
  email: string,
): boolean {
  const allowed = getAllowedDomains(metadata);
  if (allowed.length === 0) return true;
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  return allowed.includes(domain);
}
