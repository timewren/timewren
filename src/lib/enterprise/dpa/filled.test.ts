import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
}));

import { DPA_VERSION } from "./content";
import { loadFilledDpa, resolveDpaViewer } from "./filled";
import { decideFilledAccess } from "./http";

type Role = "owner" | "admin" | "member";

/** Alle streng-parametre i en drizzle-betingelse (org-id, version osv.). */
function params(node: unknown, seen = new Set<unknown>()): string[] {
  if (node === null || node === undefined || seen.has(node)) return [];
  if (typeof node === "string") return [node];
  if (typeof node !== "object") return [];
  seen.add(node);
  const out: string[] = [];
  for (const v of Object.values(node as Record<string, unknown>)) {
    out.push(...params(v, seen));
  }
  return out;
}
const orgIn = (where: unknown) =>
  params(where).find((p) => p.startsWith("org-")) ?? null;

const ORGS = {
  "org-A": {
    name: "Org A ApS",
    profile: { name: "A Firma ApS", cvr: "11111111" },
  },
  "org-B": {
    name: "Org B ApS",
    profile: { name: "B Firma ApS", cvr: "22222222" },
  },
  "org-C": { name: "Org C uden profil", profile: null },
} as const;

function makeDb(opts: {
  roles: Record<string, Role>;
  activeOrg?: string;
  acceptances?: { org: string; version: string; name: string }[];
  requireTwoFactor?: boolean;
  twoFactorEnabled?: boolean;
}) {
  const db = {
    query: {
      sessions: {
        findFirst: async () => ({ activeOrganizationId: opts.activeOrg }),
      },
      members: {
        findFirst: async (args: { where?: unknown; orderBy?: unknown }) => {
          const orgId = orgIn(args.where);
          if (orgId) {
            const role = opts.roles[orgId];
            return role
              ? { id: `m-${orgId}`, role, organizationId: orgId }
              : undefined;
          }
          // Fallback-opslag uden org: første medlemskab
          const first = Object.entries(opts.roles)[0];
          return first
            ? { id: `m-${first[0]}`, role: first[1], organizationId: first[0] }
            : undefined;
        },
      },
      companyProfiles: {
        findFirst: async (args: { where: unknown }) => {
          const org = ORGS[orgIn(args.where) as keyof typeof ORGS];
          return org?.profile
            ? { name: org.profile.name, cvrNumber: org.profile.cvr }
            : undefined;
        },
      },
      organizations: {
        findFirst: async (args: { where: unknown }) => {
          const id = orgIn(args.where) as keyof typeof ORGS;
          const org = ORGS[id];
          return org
            ? {
                name: org.name,
                requireTwoFactorForManagers: !!opts.requireTwoFactor,
              }
            : undefined;
        },
      },
      users: {
        findFirst: async () => ({ twoFactorEnabled: !!opts.twoFactorEnabled }),
      },
      orgDpaAcceptances: {
        findFirst: async (args: { where: unknown }) => {
          const ps = params(args.where);
          const hit = (opts.acceptances ?? []).find(
            (a) => ps.includes(a.org) && ps.includes(a.version),
          );
          return hit
            ? {
                version: hit.version,
                acceptedByName: hit.name,
                acceptedByEmail: "x@test.local",
                acceptedAt: new Date("2026-10-11T12:05:00Z"),
              }
            : undefined;
        },
      },
    },
  };
  return db as never;
}

const session = (activeOrg?: string) => ({
  user: { id: "user-me" },
  activeOrganizationId: activeOrg,
});

describe("udfyldt DPA: organisation og navn/CVR", () => {
  it("org A får A's navn og CVR, org B får B's", async () => {
    const db = makeDb({ roles: { "org-A": "owner", "org-B": "admin" } });
    const a = await loadFilledDpa(db, "org-A");
    const b = await loadFilledDpa(db, "org-B");
    expect(a).toMatchObject({ customerName: "A Firma ApS", cvr: "11111111" });
    expect(b).toMatchObject({ customerName: "B Firma ApS", cvr: "22222222" });
    expect(JSON.stringify(a)).not.toContain("B Firma");
    expect(JSON.stringify(b)).not.toContain("11111111");
  });

  it("uden virksomhedsprofil: organisationens navn og tomt CVR", async () => {
    const db = makeDb({ roles: { "org-C": "owner" } });
    expect(await loadFilledDpa(db, "org-C")).toEqual({
      customerName: "Org C uden profil",
      cvr: null,
      acceptance: null,
    });
  });

  it("viser kun accept af den gældende version", async () => {
    const old = makeDb({
      roles: { "org-A": "owner" },
      acceptances: [{ org: "org-A", version: "1.0", name: "Gammel Accept" }],
    });
    expect((await loadFilledDpa(old, "org-A")).acceptance).toBeNull();

    const current = makeDb({
      roles: { "org-A": "owner" },
      acceptances: [
        { org: "org-B", version: DPA_VERSION, name: "Fremmed Org" },
        { org: "org-A", version: DPA_VERSION, name: "Test Ejer" },
      ],
    });
    const acc = (await loadFilledDpa(current, "org-A")).acceptance;
    expect(acc).toMatchObject({ name: "Test Ejer", version: DPA_VERSION });
  });

  it("en forfalsket activeOrganizationId giver ikke adgang til den org", async () => {
    // Brugeren er kun medlem af A, men sessionen påstår B
    const db = makeDb({ roles: { "org-A": "admin" }, activeOrg: "org-B" });
    const viewer = await resolveDpaViewer(db, session("org-B"));
    expect(viewer).toMatchObject({ kind: "admin", orgId: "org-A" });
  });
});

describe("udfyldt DPA: hvem må hente", () => {
  it("anonym får 401", async () => {
    const db = makeDb({ roles: {} });
    const v = await resolveDpaViewer(db, null);
    expect(await decideFilledAccess(db, v)).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("bruger uden organisation får 403", async () => {
    const db = makeDb({ roles: {} });
    const v = await resolveDpaViewer(db, session());
    expect(v.kind).toBe("no-org");
    expect(await decideFilledAccess(db, v)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("medarbejder får 403 (kan kun hente den generelle)", async () => {
    const db = makeDb({ roles: { "org-A": "member" }, activeOrg: "org-A" });
    const v = await resolveDpaViewer(db, session("org-A"));
    expect(v.kind).toBe("member");
    expect(await decideFilledAccess(db, v)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("ejer og administrator får adgang til netop den aktive org", async () => {
    for (const role of ["owner", "admin"] as const) {
      const db = makeDb({ roles: { "org-A": role }, activeOrg: "org-A" });
      const v = await resolveDpaViewer(db, session("org-A"));
      expect(await decideFilledAccess(db, v)).toEqual({
        ok: true,
        orgId: "org-A",
        userId: "user-me",
      });
    }
  });

  it("administrator uden 2FA afvises, når organisationen kræver 2FA", async () => {
    const db = makeDb({
      roles: { "org-A": "admin" },
      activeOrg: "org-A",
      requireTwoFactor: true,
      twoFactorEnabled: false,
    });
    const v = await resolveDpaViewer(db, session("org-A"));
    expect(await decideFilledAccess(db, v)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe("acceptens IP-adresse", () => {
  it("bruger proxyens sidste X-Forwarded-For-værdi, ikke klientens første", async () => {
    const { clientIpFromHeaders } = await import("./accept");
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(clientIpFromHeaders(h)).toBe("203.0.113.9");
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
});
