import { describe, expect, it } from "vitest";
import {
  decideAutoJoin,
  decodeIdTokenClaims,
  emailDomain,
  emailProvenByToken,
  isFreeEmailDomain,
  matchVerifiedDomain,
  normalizeDomain,
  normalizeTenantId,
  tenantMatches,
} from "./domains";

// GUID-lignende test-værdier bygges ved runtime (secret-scannere)
const guid = (h: string) =>
  `${h.repeat(8)}-${h.repeat(4)}-4${h.repeat(3)}-8${h.repeat(3)}-${h.repeat(12)}`;
const TENANT = guid("a");
const OTHER_TENANT = guid("0");
const ATTACKER_TENANT = guid("9");

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (s: string) =>
    Buffer.from(s, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64(JSON.stringify({ alg: "RS256" }))}.${b64(JSON.stringify(payload))}.sig`;
}

describe("normalizeDomain", () => {
  it("lowercaser og trimmer", () => {
    expect(normalizeDomain("  EKSEMPEL.DK ")).toBe("eksempel.dk");
  });
  it("fjerner @, protokol, sti og trailing punktum", () => {
    expect(normalizeDomain("@eksempel.dk")).toBe("eksempel.dk");
    expect(normalizeDomain("https://eksempel.dk/login")).toBe("eksempel.dk");
    expect(normalizeDomain("eksempel.dk.")).toBe("eksempel.dk");
  });
  it("afviser ugyldige domæner", () => {
    expect(normalizeDomain("eksempel")).toBeNull();
    expect(normalizeDomain("-bad.dk")).toBeNull();
    expect(normalizeDomain("a b.dk")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("mads@eksempel.dk")).toBeNull();
  });
  it("accepterer subdomæner", () => {
    expect(normalizeDomain("It.EKSEMPEL.dk")).toBe("it.eksempel.dk");
  });
});

describe("emailDomain", () => {
  it("returnerer lowercased domæne", () => {
    expect(emailDomain("Mette.Hansen@EKSEMPEL.dk")).toBe("eksempel.dk");
  });
  it("returnerer null for ugyldige e-mails", () => {
    expect(emailDomain("ikke-en-mail")).toBeNull();
    expect(emailDomain("@eksempel.dk")).toBeNull();
    expect(emailDomain("mads@")).toBeNull();
    expect(emailDomain(null)).toBeNull();
  });
});

describe("isFreeEmailDomain", () => {
  it("kender gratis-udbydere uanset case", () => {
    expect(isFreeEmailDomain("gmail.com")).toBe(true);
    expect(isFreeEmailDomain("Outlook.dk")).toBe(true);
    expect(isFreeEmailDomain("hotmail.com")).toBe(true);
  });
  it("afviser ikke arbejdsdomæner", () => {
    expect(isFreeEmailDomain("eksempel.dk")).toBe(false);
  });
});

describe("matchVerifiedDomain", () => {
  const domains = [
    { domain: "eksempel.dk", status: "verified" },
    { domain: "pending.dk", status: "pending" },
  ];
  it("matcher case-insensitivt på eksakt domæne", () => {
    expect(matchVerifiedDomain("Rasmus@EKSEMPEL.DK", domains)?.domain).toBe(
      "eksempel.dk",
    );
  });
  it("matcher IKKE subdomæner af et verificeret domæne", () => {
    expect(matchVerifiedDomain("x@it.eksempel.dk", domains)).toBeNull();
  });
  it("matcher IKKE et overordnet domæne når kun subdomænet er verificeret", () => {
    const sub = [{ domain: "it.eksempel.dk", status: "verified" }];
    expect(matchVerifiedDomain("x@eksempel.dk", sub)).toBeNull();
    expect(matchVerifiedDomain("x@it.eksempel.dk", sub)?.domain).toBe(
      "it.eksempel.dk",
    );
  });
  it("ignorerer pending domæner", () => {
    expect(matchVerifiedDomain("x@pending.dk", domains)).toBeNull();
  });
  it("afviser gratis-domæner selv hvis nogen fik dem 'verificeret'", () => {
    const bad = [{ domain: "gmail.com", status: "verified" }];
    expect(matchVerifiedDomain("x@gmail.com", bad)).toBeNull();
  });
  it("afviser look-alike domæner", () => {
    expect(matchVerifiedDomain("x@eksempel.dk.evil.com", domains)).toBeNull();
    expect(matchVerifiedDomain("x@noteksempel.dk", domains)).toBeNull();
  });
});

describe("tenantMatches", () => {
  it("matcher alt når org'en ikke kræver tenant", () => {
    expect(tenantMatches(null, null)).toBe(true);
    expect(tenantMatches("", TENANT)).toBe(true);
  });
  it("kræver identisk tid (case-insensitivt) når tenant er sat", () => {
    expect(tenantMatches(TENANT, TENANT.toUpperCase())).toBe(true);
    expect(tenantMatches(TENANT, ` ${TENANT} `)).toBe(true);
  });
  it("afviser manglende eller forkert tid", () => {
    expect(tenantMatches(TENANT, null)).toBe(false);
    expect(tenantMatches(TENANT, OTHER_TENANT)).toBe(false);
    expect(tenantMatches(TENANT, "not-a-guid")).toBe(false);
  });
  it("normalizeTenantId afviser ikke-GUIDs", () => {
    expect(normalizeTenantId("contoso.onmicrosoft.com")).toBeNull();
    expect(normalizeTenantId(TENANT.toUpperCase())).toBe(TENANT);
  });
});

describe("decodeIdTokenClaims", () => {
  it("dekoder payload uden signaturtjek", () => {
    const claims = decodeIdTokenClaims(
      fakeJwt({ tid: TENANT, preferred_username: "m@eksempel.dk" }),
    );
    expect(claims?.tid).toBe(TENANT);
    expect(claims?.preferred_username).toBe("m@eksempel.dk");
  });
  it("returnerer null for skrald", () => {
    expect(decodeIdTokenClaims(null)).toBeNull();
    expect(decodeIdTokenClaims("abc")).toBeNull();
    expect(decodeIdTokenClaims("a.!!!.c")).toBeNull();
  });
});

describe("emailProvenByToken", () => {
  it("accepterer preferred_username eller upn der matcher", () => {
    expect(
      emailProvenByToken("m@eksempel.dk", {
        preferred_username: "m@eksempel.dk",
      }),
    ).toBe(true);
    expect(emailProvenByToken("m@eksempel.dk", { upn: "m@eksempel.dk" })).toBe(
      true,
    );
  });
  it("afviser andre adresser og manglende claims", () => {
    expect(emailProvenByToken("m@eksempel.dk", { upn: "x@eksempel.dk" })).toBe(
      false,
    );
    expect(emailProvenByToken("m@eksempel.dk", null)).toBe(false);
  });
  it("stoler ALDRIG på email-claimet (nOAuth: frit redigerbar i Entra)", () => {
    expect(
      emailProvenByToken("m@eksempel.dk", { email: "m@eksempel.dk" }),
    ).toBe(false);
  });
});

describe("decideAutoJoin", () => {
  const match = {
    organizationId: "org-a",
    ssoTenantId: null as string | null,
    autoJoinDefaultRole: "member",
  };
  const base = {
    email: "mette@eksempel.dk",
    emailVerified: true,
    microsoftClaims: null,
    match,
    existingMembershipOrgIds: [] as string[],
  };

  it("joiner verificeret domæne med default-rolle member", () => {
    expect(decideAutoJoin(base)).toEqual({
      join: true,
      organizationId: "org-a",
      role: "member",
      via: "email",
    });
  });

  it("er idempotent: eksisterende medlem joines ikke igen", () => {
    expect(
      decideAutoJoin({ ...base, existingMembershipOrgIds: ["org-a"] }),
    ).toEqual({ join: false, reason: "already_member" });
  });

  it("joiner aldrig uden verificeret domæne", () => {
    expect(decideAutoJoin({ ...base, match: null })).toEqual({
      join: false,
      reason: "no_verified_domain",
    });
  });

  it("joiner aldrig gratis-domæner", () => {
    expect(decideAutoJoin({ ...base, email: "x@gmail.com" })).toEqual({
      join: false,
      reason: "free_domain",
    });
  });

  it("kræver bevist e-mail (verificeret eller Microsoft-claim + tenant)", () => {
    expect(decideAutoJoin({ ...base, emailVerified: false })).toEqual({
      join: false,
      reason: "email_not_proven",
    });
    // Token-bevis uden tenant-binding er ikke nok (nOAuth)
    expect(
      decideAutoJoin({
        ...base,
        emailVerified: false,
        microsoftClaims: {
          tid: TENANT,
          preferred_username: "mette@eksempel.dk",
        },
      }),
    ).toEqual({ join: false, reason: "tenant_required" });
    // Token-bevis + tenant-binding + tid-match → join
    expect(
      decideAutoJoin({
        ...base,
        emailVerified: false,
        match: { ...match, ssoTenantId: TENANT },
        microsoftClaims: {
          tid: TENANT,
          preferred_username: "mette@eksempel.dk",
        },
      }),
    ).toMatchObject({ join: true, via: "microsoft" });
  });

  it("nOAuth: angriber-tenant med spoofet email-claim afvises", () => {
    const attacker = {
      tid: ATTACKER_TENANT,
      email: "victim@eksempel.dk",
      preferred_username: "attacker@evil.onmicrosoft.com",
    };
    expect(
      decideAutoJoin({
        ...base,
        email: "victim@eksempel.dk",
        emailVerified: false,
        microsoftClaims: attacker,
      }),
    ).toEqual({ join: false, reason: "email_not_proven" });
    expect(
      decideAutoJoin({
        ...base,
        email: "victim@eksempel.dk",
        emailVerified: false,
        match: { ...match, ssoTenantId: TENANT },
        microsoftClaims: attacker,
      }),
    ).toEqual({ join: false, reason: "email_not_proven" });
  });

  it("kræver tenant-match når org'en har tenant-ID", () => {
    const tenantMatch = { ...match, ssoTenantId: TENANT };
    // e-mail/password-login uden Microsoft-konto → afvist
    expect(decideAutoJoin({ ...base, match: tenantMatch })).toEqual({
      join: false,
      reason: "tenant_mismatch",
    });
    // Microsoft-login fra anden tenant → afvist
    expect(
      decideAutoJoin({
        ...base,
        match: tenantMatch,
        microsoftClaims: {
          tid: OTHER_TENANT,
          preferred_username: "mette@eksempel.dk",
        },
      }),
    ).toEqual({ join: false, reason: "tenant_mismatch" });
    // Korrekt tenant → join
    expect(
      decideAutoJoin({
        ...base,
        match: tenantMatch,
        microsoftClaims: {
          tid: TENANT.toUpperCase(),
          preferred_username: "mette@eksempel.dk",
        },
      }),
    ).toMatchObject({ join: true, via: "microsoft" });
  });

  it("mapper default-rolle manager, alt andet bliver member", () => {
    expect(
      decideAutoJoin({
        ...base,
        match: { ...match, autoJoinDefaultRole: "manager" },
      }),
    ).toMatchObject({ join: true, role: "manager" });
    expect(
      decideAutoJoin({
        ...base,
        match: { ...match, autoJoinDefaultRole: "admin" },
      }),
    ).toMatchObject({ join: true, role: "member" });
  });
});
