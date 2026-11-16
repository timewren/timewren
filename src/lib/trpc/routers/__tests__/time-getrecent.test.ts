/**
 * time.getRecent kører på hver side (timerbjælken), så den må kun hente de
 * kolonner, der bruges, og ikke hele klient- og projektrækker. Testen kører
 * den rigtige router gennem `createCaller` og fanger findMany-argumenterne.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => "org-recent"),
  resolveRequestedOrgId: vi.fn(async ({ orgId }: { orgId: string }) => orgId),
}));
vi.mock("../enterprise/middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../enterprise/middleware")>()),
  resolveModules: vi.fn(async () => ({
    raw: new Map(),
    isAvailable: () => true,
    isEnabled: () => true,
  })),
}));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import { timeRouter } from "../time";

const USER = "user-recent";
const ORG = "org-recent";

function stub(row: unknown) {
  return { findFirst: async () => row, findMany: async () => [row] };
}

function entry(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    projectId: "p1",
    clientId: null,
    taskId: null,
    description: "Design af forside",
    hours: "1.50",
    createdAt: new Date("2026-11-01T10:00:00Z"),
    project: {
      name: "Webshop",
      clientId: "c1",
      client: { name: "Testkunde ApS" },
    },
    client: null,
    ...over,
  };
}

function setup(rows: unknown[]) {
  const calls: Array<Record<string, unknown>> = [];
  const db = {
    query: {
      users: stub({ id: USER, role: "user" }),
      subscriptions: stub({
        id: "sub",
        userId: USER,
        organizationId: ORG,
        status: "active",
        planTier: "solo",
        trialEndsAt: new Date("2099-01-01T00:00:00Z"),
        pastDueSince: null,
      }),
      members: stub({ userId: USER, organizationId: ORG, role: "owner" }),
      employeeProfiles: stub(undefined),
      timeEntries: {
        findMany: async (args: Record<string, unknown>) => {
          calls.push(args);
          return rows;
        },
      },
    },
  };
  const caller = timeRouter.createCaller({
    db,
    session: { user: { id: USER } },
    headers: new Headers(),
  } as never);
  return { caller, calls };
}

describe("time.getRecent", () => {
  it("giver unikke opgaver med klientnavn fra projektet eller posten", async () => {
    const { caller } = setup([
      entry("e1"),
      entry("e2"), // samme projekt + tekst: springes over
      entry("e3", {
        projectId: null,
        description: "Møde",
        project: null,
        clientId: "c2",
        client: { name: "Anden Kunde A/S" },
      }),
    ]);

    const result = await caller.getRecent({ limit: 10 });

    expect(result.map((r) => r.entryId)).toEqual(["e1", "e3"]);
    expect(result[0]).toMatchObject({
      projectName: "Webshop",
      clientName: "Testkunde ApS",
      clientId: "c1",
      hours: "1.50",
    });
    expect(result[1]).toMatchObject({
      projectName: null,
      clientName: "Anden Kunde A/S",
      clientId: "c2",
    });
  });

  it("henter kun de kolonner, der bruges", async () => {
    const { caller, calls } = setup([]);

    await caller.getRecent({ limit: 5 });

    const args = calls[0] as {
      columns?: Record<string, boolean>;
      with: {
        project: { columns?: unknown; with: { client: { columns?: unknown } } };
        client: { columns?: unknown };
      };
    };
    expect(args.columns).toBeDefined();
    expect(args.with.project.columns).toBeDefined();
    expect(args.with.project.with.client.columns).toEqual({ name: true });
    expect(args.with.client.columns).toEqual({ name: true });
  });
});
