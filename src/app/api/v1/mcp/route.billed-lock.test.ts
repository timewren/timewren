import { TRPCError } from "@trpc/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

// MCP-værktøjerne kalder tRPC med den delte db — den peges her på en mock.
const dbHolder = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_target, key: string) => dbHolder.current[key] }),
}));
vi.mock("@/lib/email/engagement", () => ({ sendFirstTimeEntryEmail: vi.fn() }));
vi.mock("@/lib/email/prepaid", () => ({ sendLowBalanceAlert: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));
vi.mock("@/lib/api/mcp-auth", () => ({ verifyMcpToken: vi.fn() }));
vi.mock("@/lib/trpc/routers/index", async () => {
  const { router } = await import("@/lib/trpc/trpc");
  const { timeRouter } = await import("@/lib/trpc/routers/time");
  return { appRouter: router({ time: timeRouter }) };
});

// Fang de registrerede værktøjer i stedet for at starte en MCP-server.
type ToolCb = (args: unknown, extra: unknown) => Promise<unknown>;
const captured = vi.hoisted(() => ({
  init: null as null | ((server: unknown) => void),
}));
vi.mock("mcp-handler", () => ({
  createMcpHandler: (init: (server: unknown) => void) => {
    captured.init = init;
    return () => new Response();
  },
  withMcpAuth: (handler: unknown) => handler,
}));

import {
  BL_ENTRY_ID,
  BL_USER_ID,
  entryRow,
  makeTimeDb,
} from "@/test/billed-entry-mocks";
import "./route";

const tools = new Map<string, ToolCb>();
const extra = {
  http: { authInfo: { scopes: ["*"], extra: { userId: BL_USER_ID } } },
};

beforeAll(() => {
  captured.init?.({
    registerTool: (name: string, _config: unknown, cb: ToolCb) => {
      tools.set(name, cb);
    },
  });
});

describe("MCP update_time_entry — fakturerede poster (#702)", () => {
  it("afviser at ændre en faktureret post og skriver intet", async () => {
    const { db } = makeTimeDb([entryRow()]);
    dbHolder.current = db as unknown as Record<string, unknown>;
    const update = tools.get("update_time_entry");
    expect(update).toBeDefined();

    const err = await update?.(
      {
        id: BL_ENTRY_ID,
        description: "Omskrevet",
        hours: 8,
        date: "2026-09-15",
      },
      extra,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
    expect((err as TRPCError).message).toContain("Kreditér fakturaen");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("lader en ufaktureret post blive valideret videre", async () => {
    const { db } = makeTimeDb([entryRow({ isBilled: false, invoiceId: null })]);
    dbHolder.current = db as unknown as Record<string, unknown>;
    const err = await tools
      .get("update_time_entry")?.(
        { id: BL_ENTRY_ID, description: "Ny", hours: 3, date: "2026-09-15" },
        extra,
      )
      .catch((e: unknown) => e);
    // Låsen slipper posten igennem; den videre kæde (sats-opslag) rammer
    // mock-db'en, som ikke har de tabeller — men ikke en FORBIDDEN-lås.
    expect((err as TRPCError | undefined)?.code).not.toBe("FORBIDDEN");
  });
});
