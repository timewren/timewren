import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => "org-key"),
  resolveRequestedOrgId: vi.fn(async ({ orgId }: { orgId: string }) => orgId),
}));
vi.mock("../routers/enterprise/middleware", () => ({
  resolveModules: vi.fn(async () => ({})),
  makePermissiveModules: vi.fn(() => ({})),
}));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import {
  ORG_OVERRIDE_HEADER,
  orgOverrideFromRequest,
} from "@/lib/auth/org-header";
import { protectedProcedure, router } from "../trpc";

const testRouter = router({
  whichOrg: protectedProcedure.query(({ ctx }) => ctx.orgId),
});

function caller(ctx: { headers: Headers | null; orgOverride?: string | null }) {
  return testRouter.createCaller({
    session: { user: { id: "u1" } } as never,
    db: {} as never,
    ...ctx,
  });
}

describe("org-override fra offline-køen", () => {
  it("ignorerer headeren, når den kun står i request-headers (API-nøgle, MCP)", async () => {
    const headers = new Headers({ [ORG_OVERRIDE_HEADER]: "org-b" });
    await expect(caller({ headers }).whichOrg()).resolves.toBe("org-key");
  });

  it("bruger den eksplicitte kontekst-org fra /api/trpc", async () => {
    await expect(
      caller({ headers: null, orgOverride: "org-b" }).whichOrg(),
    ).resolves.toBe("org-b");
  });
});

describe("orgOverrideFromRequest", () => {
  const base = { [ORG_OVERRIDE_HEADER]: "org-b" };

  it("læser headeren på et almindeligt cookie-kald", () => {
    expect(orgOverrideFromRequest(new Headers(base))).toBe("org-b");
  });

  it.each([
    { authorization: "Bearer tt_abc" },
    { "x-extension-token": "abc" },
    { "x-api-key": "abc" },
    { origin: "chrome-extension://abcdef" },
  ] as Record<string, string>[])(
    "afviser headeren ved token-/extension-kald (%o)",
    (extra) => {
      expect(
        orgOverrideFromRequest(new Headers({ ...base, ...extra })),
      ).toBeNull();
    },
  );

  it("er null uden header", () => {
    expect(orgOverrideFromRequest(new Headers())).toBeNull();
  });
});

describe("withoutOrgOverride", () => {
  it("fjerner kun org-headeren", async () => {
    const { withoutOrgOverride } = await import("@/lib/auth/org-header");
    const out = withoutOrgOverride(
      new Headers({ [ORG_OVERRIDE_HEADER]: "org-b", "x-foo": "1" }),
    );
    expect(out.get(ORG_OVERRIDE_HEADER)).toBeNull();
    expect(out.get("x-foo")).toBe("1");
  });
});
