/**
 * Web-sletninger skal skrive tombstones, så skrivebordsenheden hører om at en
 * post er væk. En hard delete efterlader intet at `pull` kan finde, så uden
 * en tombstone står posten stadig i appens lokale db, og næste redigering
 * fejler med "Entity not found" for evigt.
 *
 * Nøglen skrives på *rækkens* ejer, ikke den slettendes — ellers rydder
 * chefens enhed ikke medarbejderens post.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/email/engagement", () => ({
  sendFirstTimeEntryEmail: vi.fn(),
  sendFirstProjectEmail: vi.fn(),
}));
vi.mock("@/lib/org-audit", () => ({
  logOrgAudit: vi.fn(),
  auditDiff: vi.fn(() => ({})),
}));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));
vi.mock("@/lib/enterprise/edit-guard", () => ({
  assertEntryEditable: vi.fn(async () => undefined),
}));
vi.mock("@/lib/org/period-lock", () => ({
  assertPeriodUnlocked: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => "org-1"),
}));

import { desktopSyncTombstones } from "@/lib/db/schema";
import { extensionRouter } from "../extension";
import { projectsRouter } from "../projects";
import { timeRouter } from "../time";

const OWNER = "owner-1";
const EMPLOYEE = "employee-1";
const ORG = "org-1";
const ENTRY_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

type Row = Record<string, unknown>;

interface InsertCall {
  table: unknown;
  values: unknown;
}

/** Drizzle-tabellen som inserten skrev i — kun tombstone-tabellen er relevant. */
const TOMBSTONE_TABLE = desktopSyncTombstones;

function entry(overrides: Row = {}): Row {
  return {
    id: ENTRY_ID,
    userId: EMPLOYEE,
    organizationId: ORG,
    projectId: PROJECT_ID,
    clientId: "client-1",
    description: "Rådgivning",
    hours: "2.00",
    date: new Date("2026-09-30T00:00:00.000Z"),
    taskId: null,
    isPrepaid: false,
    prepaidPackageId: null,
    ...overrides,
  };
}

function makeDb(args: {
  timeEntries?: Row[];
  projects?: Row[];
  extensionTokens?: Row[];
  /** Får inserten til at fejle, som når migrationen ikke er kørt. */
  failInsert?: boolean;
}) {
  const inserts: InsertCall[] = [];
  const timeEntries = args.timeEntries ?? [];
  const projects = args.projects ?? [];
  const extensionTokens = args.extensionTokens ?? [];

  const recordInsert = (table: unknown) => ({
    values: async (values: unknown) => {
      inserts.push({ table, values });
      if (args.failInsert) {
        throw new Error('relation "desktop_sync_tombstones" does not exist');
      }
      return [];
    },
  });

  const chain = {
    set: () => chain,
    where: () => Promise.resolve([]),
  };
  const tx = {
    insert: recordInsert,
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  };

  // Alt andet end de opslag mutationerne faktisk bruger, svarer "intet fundet",
  // så en ny læsning i en procedure ikke slår testen ihjel.
  const empty = {
    findFirst: vi.fn(async () => undefined),
    findMany: vi.fn(async () => []),
  };
  const query = new Proxy(
    {
      users: { findFirst: vi.fn(async () => ({ role: "user" })) },
      subscriptions: { findFirst: vi.fn(async () => ({ status: "active" })) },
      organizationModules: { findMany: vi.fn(async () => []) },
      members: {
        findFirst: vi.fn(async () => ({ role: "member" })),
        findMany: vi.fn(async () => []),
      },
      timeEntries: {
        findFirst: vi.fn(async () => timeEntries[0]),
        findMany: vi.fn(async () => timeEntries),
      },
      projects: {
        findFirst: vi.fn(async () => projects[0]),
        findMany: vi.fn(async () => projects),
      },
      extensionTokens: {
        findFirst: vi.fn(async () => extensionTokens[0]),
        update: vi.fn(async () => undefined),
      },
    } as Record<string, unknown>,
    {
      get(target, prop: string) {
        return target[prop] ?? empty;
      },
    },
  );

  // select-kæder (fx #702's tjek for fakturerede poster) finder intet.
  const selectChain: Record<string, unknown> = {};
  for (const step of ["from", "where", "innerJoin", "leftJoin", "orderBy"]) {
    selectChain[step] = () => selectChain;
  }
  selectChain.limit = () => Promise.resolve([]);
  // biome-ignore lint/suspicious/noThenProperty: bevidst thenable db-builder
  selectChain.then = (resolve: (rows: unknown[]) => unknown) => resolve([]);

  const db = {
    insert: recordInsert,
    select: () => selectChain,
    update: () => chain,
    delete: () => chain,
    transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    query,
  };

  return { db, inserts, tombstones: () => tombstoneRows(inserts) };
}

function tombstoneRows(inserts: InsertCall[]): Row[] {
  return inserts
    .filter((call) => call.table === TOMBSTONE_TABLE)
    .flatMap((call) => {
      const values = call.values;
      return Array.isArray(values) ? (values as Row[]) : [values as Row];
    });
}

function session(userId: string) {
  return { user: { id: userId } };
}

function caller(db: unknown) {
  return {
    db,
    headers: new Headers(),
    session: session(OWNER),
  } as never;
}

describe("time.delete skriver en tombstone", () => {
  it("bruger rækkens ejer, ikke den slettende", async () => {
    const { db, tombstones } = makeDb({ timeEntries: [entry()] });

    const result = await timeRouter
      .createCaller(caller(db))
      .delete({ id: ENTRY_ID });

    expect(result).toEqual({ success: true });
    expect(tombstones()).toEqual([
      {
        entityType: "time_entry",
        entityId: ENTRY_ID,
        userId: EMPLOYEE,
        organizationId: ORG,
      },
    ]);
  });

  it("svarer success selv om tabellen ikke findes endnu", async () => {
    // Migrationen er skrevet, men Mads kører den. En slettet tid må ikke blive
    // liggende, fordi vi ikke fik skrevet en notits-række.
    //
    // Denne mock har intet `.transaction`, så den kan IKKE bevise at sletningen
    // overlever en fejl i notits-inserten. Det er målt mod en rigtig Postgres i
    // sync-tombstones.integration.test.ts (kræver TEST_DATABASE_URL). Her
    // bekræfter testen kun, at mutationen ikke kaster.
    const { db, tombstones } = makeDb({
      timeEntries: [entry()],
      failInsert: true,
    });

    const result = await timeRouter
      .createCaller(caller(db))
      .delete({ id: ENTRY_ID });

    expect(result).toEqual({ success: true });
    expect(tombstones()).toHaveLength(1);
  });
});

describe("time.bulkDelete skriver en tombstone pr. post", () => {
  it("én insert med alle rækkerne", async () => {
    const rows = [
      entry({ id: "55555555-5555-4555-8555-555555555555" }),
      entry({ id: "66666666-6666-4666-8666-666666666666" }),
    ];
    const { db, inserts, tombstones } = makeDb({ timeEntries: rows });

    await timeRouter
      .createCaller(caller(db))
      .bulkDelete({ ids: rows.map((r) => r.id as string) });

    expect(tombstones().map((row) => row.entityId)).toEqual([
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ]);
    // Én statement, ikke én pr. post
    expect(inserts).toHaveLength(1);
    expect(tombstones().map((row) => row.organizationId)).toEqual([ORG, ORG]);
  });
});

describe("projects.permanentDelete skriver en tombstone", () => {
  it("på projektrækken, med dens ejer", async () => {
    const { db, tombstones } = makeDb({
      projects: [
        {
          id: PROJECT_ID,
          userId: EMPLOYEE,
          organizationId: ORG,
          name: "Kunde A",
        },
      ],
    });

    await projectsRouter
      .createCaller(caller(db))
      .permanentDelete({ id: PROJECT_ID, confirmName: "Kunde A" });

    expect(tombstones()).toEqual([
      {
        entityType: "project",
        entityId: PROJECT_ID,
        userId: EMPLOYEE,
        organizationId: ORG,
      },
    ]);
  });
});

describe("extension.deleteTimeEntry skriver en tombstone", () => {
  it("fordi sletningen fra browseren også skal nå skrivebordet", async () => {
    const { db, tombstones } = makeDb({
      timeEntries: [entry()],
      extensionTokens: [{ id: "token-1", userId: EMPLOYEE }],
    });

    const result = await extensionRouter
      .createCaller({ db, headers: new Headers(), session: null } as never)
      .deleteTimeEntry({ token: "ext-token", id: ENTRY_ID });

    expect(result).toEqual({ success: true });
    expect(tombstones()).toEqual([
      {
        entityType: "time_entry",
        entityId: ENTRY_ID,
        userId: EMPLOYEE,
        organizationId: ORG,
      },
    ]);
  });
});
