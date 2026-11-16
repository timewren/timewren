/**
 * Domæne-match og tenant-match til Entra ID auto-join (E12, #470).
 *
 * Rene funktioner uden DB — testes i domains.test.ts. Al sikkerhedslogik
 * (hvilke domæner der må auto-joine, hvornår tenant kræves) ligger her, så
 * auth-hooks og tRPC-router kun er glue.
 */

/**
 * Gratis/offentlige mail-udbydere der ALDRIG kan bruges til auto-join —
 * ingen enkelt organisation ejer dem, og en DNS-verifikation af fx gmail.com
 * er alligevel umulig. Tjekkes både ved tilføjelse og ved login (defensivt).
 */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.dk",
  "hotmail.com",
  "hotmail.dk",
  "hotmail.co.uk",
  "live.com",
  "live.dk",
  "msn.com",
  "yahoo.com",
  "yahoo.dk",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "pm.me",
  "mail.com",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "zoho.com",
  "yandex.com",
  "mail.ru",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "tuta.io",
]);

// RFC 1035-agtig hostname: labels a-z0-9 og bindestreg (ikke først/sidst),
// mindst ét punktum (eksempel.dk), TLD kun bogstaver.
const DOMAIN_RE =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Normalisér et domæne som admin taster det: trim, lowercase, fjern "@",
 * "https://", sti og trailing punktum. Returnerer null hvis ugyldigt.
 */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^@/, "");
  d = d.split("/")[0] ?? "";
  d = d.replace(/\.+$/, "");
  if (!DOMAIN_RE.test(d)) return null;
  return d;
}

/** Lowercased domæne fra en e-mail, eller null hvis e-mailen er ugyldig. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  const domain = trimmed.slice(at + 1);
  return DOMAIN_RE.test(domain) ? domain : null;
}

export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

export interface VerifiedDomainCandidate {
  domain: string;
  status: string;
}

/**
 * Find det verificerede domæne en e-mail matcher. Kun EKSAKT match —
 * `it.eksempel.dk` matcher ikke `eksempel.dk`; et subdomæne skal verificeres for
 * sig. Det er den konservative regel: en DNS-record på apex beviser ikke
 * kontrol over alle subdomæner (fx delegerede zoner).
 */
export function matchVerifiedDomain<T extends VerifiedDomainCandidate>(
  email: string,
  candidates: readonly T[],
): T | null {
  const domain = emailDomain(email);
  if (!domain) return null;
  if (isFreeEmailDomain(domain)) return null;
  for (const c of candidates) {
    if (c.status !== "verified") continue;
    if (c.domain.trim().toLowerCase() === domain) return c;
  }
  return null;
}

/** Entra tenant-GUID (8-4-4-4-12 hex). */
const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeTenantId(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const t = input.trim().toLowerCase();
  return GUID_RE.test(t) ? t : null;
}

/**
 * Tenant-match: har org'en intet tenant-krav, matcher alt. Har den et,
 * SKAL id_tokenens `tid` findes og være identisk (case-insensitivt).
 * Mangler tid (fx ved login med e-mail og adgangskode) → ikke match.
 */
export function tenantMatches(
  orgTenantId: string | null | undefined,
  tokenTid: string | null | undefined,
): boolean {
  const required = normalizeTenantId(orgTenantId);
  if (!required) return true;
  const actual = normalizeTenantId(tokenTid);
  return actual !== null && actual === required;
}

export interface IdTokenClaims {
  tid?: string;
  email?: string;
  preferred_username?: string;
  upn?: string;
  [key: string]: unknown;
}

/**
 * Dekod payload fra et JWT UDEN signaturtjek. Tokenet kommer fra Better-Auths
 * server-side code-exchange mod Microsofts token-endpoint over TLS og er
 * gemt på account-rækken — vi læser kun claims, vi autentificerer ikke på
 * dem alene (domænet er DNS-verificeret og kontoen er allerede logget ind).
 */
export function decodeIdTokenClaims(
  idToken: string | null | undefined,
): IdTokenClaims | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object"
      ? (parsed as IdTokenClaims)
      : null;
  } catch {
    return null;
  }
}

/**
 * Er brugerens e-mail "bevist" af Microsoft-tokenet? Kun `preferred_username`
 * og `upn` tæller — de er bundet til tenantens verificerede domæner. `email`
 * er en FRIT REDIGERBAR attribut i Entra (nOAuth): en angriber med egen
 * tenant kan sætte mail=victim@eksempel.dk. Derfor bruges `email` aldrig som
 * bevis, og token-bevis alene kræver desuden tenant-match (se decideAutoJoin).
 * Baggrund: Graph userinfo returnerer ofte email_verified=false selv for
 * arbejdskonti, så Better-Auths emailVerified er false ved Microsoft-login.
 */
export function emailProvenByToken(
  userEmail: string,
  claims: IdTokenClaims | null,
): boolean {
  if (!claims) return false;
  const target = userEmail.trim().toLowerCase();
  for (const key of ["preferred_username", "upn"] as const) {
    const v = claims[key];
    if (typeof v === "string" && v.trim().toLowerCase() === target) return true;
  }
  return false;
}

export type AutoJoinDenyReason =
  | "no_email"
  | "free_domain"
  | "no_verified_domain"
  | "already_member"
  | "email_not_proven"
  | "tenant_required"
  | "tenant_mismatch";

export interface AutoJoinDecisionInput {
  email: string;
  emailVerified: boolean;
  /** Claims fra brugerens microsoft-entra-id-konto (null = ingen MS-konto) */
  microsoftClaims: IdTokenClaims | null;
  /** Verificeret domæne-række + org-indstillinger */
  match: {
    organizationId: string;
    ssoTenantId: string | null;
    autoJoinDefaultRole: string;
  } | null;
  existingMembershipOrgIds: readonly string[];
}

export type AutoJoinDecision =
  | {
      join: true;
      organizationId: string;
      role: "member" | "manager";
      via: "microsoft" | "email";
    }
  | { join: false; reason: AutoJoinDenyReason };

/** Ren beslutning: må denne bruger auto-joine, og med hvilken rolle? */
export function decideAutoJoin(input: AutoJoinDecisionInput): AutoJoinDecision {
  const domain = emailDomain(input.email);
  if (!domain) return { join: false, reason: "no_email" };
  if (isFreeEmailDomain(domain)) return { join: false, reason: "free_domain" };
  if (!input.match) return { join: false, reason: "no_verified_domain" };
  if (input.existingMembershipOrgIds.includes(input.match.organizationId)) {
    return { join: false, reason: "already_member" };
  }
  const provenByToken = emailProvenByToken(input.email, input.microsoftClaims);
  if (!input.emailVerified && !provenByToken) {
    return { join: false, reason: "email_not_proven" };
  }
  // Token-bevis alene er kun gyldigt når org'en har bundet sin tenant —
  // ellers kan enhver Entra-tenant udstede claims for vilkårlige adresser.
  if (
    !input.emailVerified &&
    provenByToken &&
    !normalizeTenantId(input.match.ssoTenantId)
  ) {
    return { join: false, reason: "tenant_required" };
  }
  if (!tenantMatches(input.match.ssoTenantId, input.microsoftClaims?.tid)) {
    return { join: false, reason: "tenant_mismatch" };
  }
  const role =
    input.match.autoJoinDefaultRole === "manager" ? "manager" : "member";
  return {
    join: true,
    organizationId: input.match.organizationId,
    role,
    via: input.microsoftClaims ? "microsoft" : "email",
  };
}
