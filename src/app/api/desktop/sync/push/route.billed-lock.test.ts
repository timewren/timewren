import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  existing: null as Record<string, unknown> | null,
  sets: [] as Record<string, unknown>[],
  txSets: [] as Record<string, unknown>[],
  transactions: 0,
}));

// Push-ruten læser rækken via select().from().where(), opdaterer enheden og
// skriver sync-log. Alt andet end det må ikke ske for en faktureret post.
vi.mock("@/lib/db", () => {
  const chain = () => ({
    set: (values: Record<string, unknown>) => {
      state.sets.push(values);
      return { where: async () => undefined };
    },
  });
  const db = {
    update: vi.fn(chain),
    select: () => ({
      from: () => ({
        where: () => {
          const rows = state.existing ? [state.existing] : [];
          return Object.assign(Promise.resolve(rows), {
            for: async () => rows,
          });
        },
      }),
    }),
    // Øvrige tabeller (org-opslag) svarer tomt.
    query: new Proxy(
      { timeEntries: { findFirst: async () => state.existing } },
      {
        get: (target, key) =>
          key in target
            ? target[key as keyof typeof target]
            : { findFirst: async () => undefined, findMany: async () => [] },
      },
    ),
    insert: () => ({ values: async () => undefined }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      state.transactions++;
      const tx = {
        ...db,
        transaction: async (nested: (tx: unknown) => Promise<unknown>) =>
          nested(tx),
        update: () => ({
          set: (values: Record<string, unknown>) => {
            state.txSets.push(values);
            return { where: async () => undefined };
          },
        }),
      };
      return fn(tx);
    }),
  };
  return { db };
});
vi.mock("@/lib/desktop-auth", () => ({
  authenticateDevice: async () => ({
    userId: "user-billed-lock",
    deviceId: "device-1",
  }),
}));
vi.mock("@/lib/desktop-org", () => ({
  resolveDesktopOrgId: async () => "bl-org",
}));
vi.mock("@/lib/desktop-rate-limit", () => ({
  checkRateLimit: () => true,
  getClientIp: () => "127.0.0.1",
  rateLimitResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/org/period-lock", () => ({
  assertPeriodUnlocked: vi.fn(async () => undefined),
}));
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/time/task-locks", () => ({
  lockTimeEntryTasks: vi.fn(
    async (_tx, ids: Array<string | null | undefined>) =>
      ids.filter(Boolean).map((id) => ({ id })),
  ),
}));

vi.mock("@/lib/trpc/routers/prepaid", () => ({
  lockPrepaidPackages: vi.fn(async () => {}),
  deductHoursCore: vi.fn(),
  reversePrepaidUsage: vi.fn(),
}));

import { BL_ENTRY_ID, entryRow } from "@/test/billed-entry-mocks";
import { POST } from "./route";

function push(action: "update" | "delete", data: Record<string, unknown>) {
  return POST(
    new Request("https://timetrack.test/api/desktop/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entities: [{ type: "time_entry", action, data }],
      }),
    }),
  );
}

describe("desktop-sync push — fakturerede poster (#702)", () => {
  beforeEach(() => {
    state.existing = entryRow({ userId: "user-billed-lock" });
    state.sets = [];
    state.txSets = [];
    state.transactions = 0;
  });

  it("afviser en update der ændrer timerne og skriver intet", async () => {
    const res = await push("update", { id: BL_ENTRY_ID, hours: 7 });
    const body = await res.json();
    expect(body.accepted).toEqual([]);
    expect(body.errors[0].error).toContain("Kreditér fakturaen");
    expect(state.transactions).toBe(1);
  });

  it("afviser at desktop nulstiller faktura-koblingen", async () => {
    const res = await push("update", {
      id: BL_ENTRY_ID,
      isBilled: false,
      invoiceId: null,
    });
    const body = await res.json();
    expect(body.errors).toHaveLength(1);
    expect(state.transactions).toBe(1);
  });

  it("tillader en fuld række med uændrede værdier, lokale felter og en ny note", async () => {
    const res = await push("update", {
      id: BL_ENTRY_ID,
      hours: 2,
      description: "Arbejde",
      isBillable: true,
      startTime: null,
      notes: "Intern note",
      // Desktop-lokale felter, som ikke er kolonner på serveren
      duration: 7200,
      isRunning: false,
      klippekortId: null,
    });
    const body = await res.json();
    expect(body.errors).toEqual([]);
    expect(state.transactions).toBe(1);
    // Kun noten skrives — ikke resten af desktop-rækken
    expect(state.txSets).toHaveLength(1);
    const { updatedAt, ...written } = state.txSets[0];
    expect(written).toEqual({ notes: "Intern note" });
    expect(updatedAt).toBeInstanceOf(Date);
  });

  it("afviser sletning af en faktureret post", async () => {
    const res = await push("delete", { id: BL_ENTRY_ID });
    const body = await res.json();
    expect(body.errors[0].error).toContain("Kreditér fakturaen");
    // Kun enhedens lastSyncAt blev opdateret — posten blev ikke arkiveret
    expect(state.sets).toHaveLength(1);
    expect(state.sets[0]).toHaveProperty("lastSyncAt");
  });

  it("lader ufakturerede poster opdatere som før", async () => {
    state.existing = entryRow({
      userId: "user-billed-lock",
      isBilled: false,
      invoiceId: null,
    });
    const res = await push("update", { id: BL_ENTRY_ID, hours: 7 });
    const body = await res.json();
    expect(body.errors).toEqual([]);
    expect(state.transactions).toBe(1);
  });
});
