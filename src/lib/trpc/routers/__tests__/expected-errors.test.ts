import type { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { tr } from "@/i18n/server-text";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/utils/encryption", () => ({
  decrypt: (value: string) => value,
}));
vi.mock("@/lib/integrations/dinero-oauth", () => ({
  getValidDineroToken: vi.fn(async () => null),
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  ipRateLimitKey: () => "test",
  rateLimiter: { check: vi.fn(async () => ({ allowed: false })) },
}));

import { integrationsRouter } from "../integrations";
import { publicPortalRouter } from "../publicPortal";

// Exercise router bodies without authentication/subscription middleware, which
// has its own tests. No database or external integration is contacted.
function resolve(procedure: unknown, db: unknown, input: unknown = {}) {
  const { resolver } = (
    procedure as {
      _def: { resolver: (options: unknown) => Promise<unknown> };
    }
  )._def;
  return resolver({
    ctx: { db, session: { user: { id: "owner" } }, orgId: null },
    input,
  });
}

async function rejectsWith(
  result: Promise<unknown>,
  code: TRPCError["code"],
  key: string,
) {
  const message = await tr("serverErrors", key);
  await expect(result).rejects.toMatchObject({ code, message });
}

describe("expected integration errors", () => {
  it("reports an expired Dinero connection", async () => {
    const db = {
      query: {
        users: {
          findFirst: vi.fn(async () => ({ dineroRefreshToken: "expired" })),
        },
      },
    };
    await rejectsWith(
      resolve(integrationsRouter.getDineroAccounts, db),
      "BAD_REQUEST",
      "integrations.dinero.expired",
    );
  });
  it.each([
    ["getBillyAccounts", "integrations.billy.noApiKey"],
    ["getEconomicAccounts", "integrations.economic.noTokens"],
    ["getDineroAccounts", "integrations.dinero.notConnectedShort"],
  ] as const)("%s reports missing configuration", async (method, key) => {
    const db = { query: { users: { findFirst: vi.fn(async () => ({})) } } };
    await rejectsWith(
      resolve(integrationsRouter[method], db),
      "BAD_REQUEST",
      key,
    );
  });

  it("reports a missing scoped client", async () => {
    const db = {
      query: {
        users: { findFirst: vi.fn(async () => ({ billyApiKey: "test-key" })) },
        clients: { findFirst: vi.fn(async () => undefined) },
      },
    };
    await rejectsWith(
      resolve(integrationsRouter.exportClientToBilly, db, {
        clientId: "client",
      }),
      "NOT_FOUND",
      "common.clientNotFound",
    );
  });

  it.each(["importClockify", "importToggl", "importHarvest"] as const)(
    "%s rejects a CSV without valid rows",
    async (method) => {
      await rejectsWith(
        resolve(
          integrationsRouter[method],
          {},
          { csvContent: "", dateFormat: "dmy" },
        ),
        "BAD_REQUEST",
        "integrations.import.noValidRows",
      );
    },
  );

  it("preserves unexpected database failures", async () => {
    const failure = new Error("Database unavailable");
    const db = {
      query: { users: { findFirst: vi.fn().mockRejectedValue(failure) } },
    };
    await expect(resolve(integrationsRouter.getBillyAccounts, db)).rejects.toBe(
      failure,
    );
  });
});

describe("expected portal errors", () => {
  const access = {
    id: "access",
    clientId: "client",
    freelancerId: "owner",
    canViewInvoices: true,
    canViewProjects: true,
    canViewPrepaid: true,
    canApproveTime: true,
  };
  function db(allowed: boolean, request?: { status: string }) {
    return {
      query: {
        clientPortalAccess: {
          findFirst: vi.fn(async () => (allowed ? access : undefined)),
        },
        clients: { findFirst: vi.fn(async () => ({ organizationId: null })) },
        invoices: { findFirst: vi.fn(async () => undefined) },
        projects: { findFirst: vi.fn(async () => undefined) },
        prepaidPackages: { findFirst: vi.fn(async () => undefined) },
        timeApprovalRequests: { findFirst: vi.fn(async () => request) },
      },
    };
  }

  it.each([
    ["getInvoices", "portal.noInvoiceAccess"],
    ["getProjects", "portal.noProjectAccess"],
    ["getTimeReport", "portal.noTimeAccess"],
    ["getPrepaidPackages", "portal.noPrepaidAccess"],
    ["getDashboard", "portal.noAccess"],
    ["approveRequest", "portal.notAllowedApprove"],
    ["rejectRequest", "portal.notAllowedReject"],
  ] as const)("%s denies invalid or expired access", async (method, key) => {
    await rejectsWith(
      resolve(publicPortalRouter[method], db(false), {
        accessToken: "expired",
      }),
      "FORBIDDEN",
      key,
    );
  });

  it.each(["approveRequest", "rejectRequest"] as const)(
    "%s distinguishes missing and handled requests",
    async (method) => {
      const input = { accessToken: "test", requestId: "request" };
      await rejectsWith(
        resolve(publicPortalRouter[method], db(true), input),
        "NOT_FOUND",
        "portal.requestNotFound",
      );
      await rejectsWith(
        resolve(
          publicPortalRouter[method],
          db(true, { status: "approved" }),
          input,
        ),
        "BAD_REQUEST",
        "portal.requestHandled",
      );
    },
  );

  it("reports the renewal rate limit", async () => {
    await rejectsWith(
      resolve(publicPortalRouter.requestRenewal, db(true), {
        accessToken: "test",
      }),
      "TOO_MANY_REQUESTS",
      "portal.tooManyRequests",
    );
  });
});
