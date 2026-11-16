/**
 * Mock-db og fixtures til test af låsen på fakturerede tidsposter (#702).
 * Dækker præcis de opslag tRPC-middlewaren (isAuthed, abonnement) og
 * time-routerens skriveveje laver for en solo-bruger, og fanger alle
 * skrivninger, så testene kan påvise at intet blev skrevet.
 */
import { vi } from "vitest";
import { timeRouter } from "@/lib/trpc/routers/time";
import { router } from "@/lib/trpc/trpc";

export const BL_USER_ID = "user-billed-lock";
export const BL_ENTRY_ID = "11111111-1111-4111-8111-111111111111";
export const BL_ENTRY_ID_2 = "22222222-2222-4222-8222-222222222222";
export const BL_PROJECT_ID = "33333333-3333-4333-8333-333333333333";
export const BL_INVOICE_ID = "44444444-4444-4444-8444-444444444444";

export type EntryRow = Record<string, unknown> & {
  id: string;
  isBilled: boolean;
  invoiceId: string | null;
};

export function entryRow(over: Partial<EntryRow> = {}): EntryRow {
  return {
    id: BL_ENTRY_ID,
    userId: BL_USER_ID,
    organizationId: null,
    projectId: BL_PROJECT_ID,
    clientId: null,
    taskId: null,
    description: "Arbejde",
    notes: null,
    hours: "2.00",
    date: new Date("2026-09-15T00:00:00Z"),
    startTime: null,
    endTime: null,
    billableRate: "800.00",
    isBillable: true,
    isBilled: true,
    invoiceId: BL_INVOICE_ID,
    isPrepaid: false,
    prepaidPackageId: null,
    approvalStatus: "not_required",
    updatedAt: new Date("2026-09-15T10:00:00Z"),
    ...over,
  };
}

/**
 * Øvrige tabeller (periodelås, timesedler, moduler …) svarer tomt, så
 * org-stierne i routerne kan køre uden en stub pr. tabel.
 */
function withEmptyTables<T extends object>(known: T): T {
  return new Proxy(known, {
    get(target, key) {
      if (key in target) return target[key as keyof T];
      return {
        findFirst: async () => undefined,
        findMany: async () => [],
      };
    },
  });
}

export function makeTimeDb(entries: EntryRow[]) {
  const sets: Record<string, unknown>[] = [];
  const forbiddenWrite = () => {
    throw new Error("uventet skrivning til databasen");
  };
  const db = {
    query: withEmptyTables({
      users: { findFirst: async () => ({ role: "admin" }) },
      sessions: { findFirst: async () => undefined },
      // Aktivt owner-medlemskab: uden org afviser isAuthed kaldet.
      members: {
        findFirst: async () => ({
          id: "bl-member",
          organizationId: "bl-org",
          userId: BL_USER_ID,
          role: "owner",
        }),
      },
      organizationModules: { findMany: async () => [] },
      timeEntries: {
        findFirst: async () => entries[0],
        findMany: async () => entries,
      },
      timeEntrySegments: {
        findFirst: async () => ({
          id: "seg-1",
          timeEntryId: entries[0]?.id,
        }),
        findMany: async () => [],
      },
    }),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        sets.push(values);
        return {
          where: () =>
            Object.assign(Promise.resolve(undefined), {
              returning: async () => [{ ...entries[0], ...values }],
            }),
        };
      },
    })),
    delete: vi.fn(forbiddenWrite),
    insert: vi.fn(forbiddenWrite),
    transaction: vi.fn(forbiddenWrite),
  };
  return { db, sets };
}

const testRouter = router({ time: timeRouter });

export function makeTimeCaller(db: unknown) {
  return testRouter.createCaller({
    session: { user: { id: BL_USER_ID, email: "bl@test.local" } },
    db,
    headers: null,
  } as never);
}
