import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Kontrakttest for desktop-pushen: den kalder den rigtige POST-handler med en
// db der optager kaldene. Formålet er at fange de fejl der lå i felt-koblingen
// mellem skrivebordsappen og time_entries — bl.a. at `hours`/`date` er NOT NULL
// mens appen sender startTime/endTime/duration.

const USER = "user-1";
const DEVICE = "device-1";
const SERVER_ID = "22222222-2222-2222-2222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  lockedReads: 0,
  transactionActive: false,
  concurrent: false,
  inserted: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  deletes: [] as Record<string, unknown>[],
  selectRows: [] as Record<string, unknown>[],
  conflictTargets: [] as unknown[],
  /** Insertet rammer unique-indekset (dublet-indsendelse). */
  insertHitsConflict: false,
  /** Rækken fundet ved en gentagelse efter et tabt svar. */
  existingOnReplay: null as string | null,
  /** Felterne på den tidspost et opslag på timeEntries svarer med. */
  timeEntryRow: null as Record<string, unknown> | null,
  /** Fakturalinjen slået op på id. */
  invoiceLine: null as Record<string, unknown> | null,
  /** Forældrefakturaen. `null` betyder: ikke brugerens → ejerskabskontrol fejler. */
  invoice: null as Record<string, unknown> | null,
  releasedEntries: [] as string[][],
  recalcs: [] as string[],
  /** Kald til markEntriesBilled og hvor mange poster det "markerer". */
  billedMarks: [] as { entryIds: string[]; invoiceId: string }[],
  /** Rammer arkiveringen en række (false = fremmed eller ukendt id). */
  archiveHits: true,
  markResult: 1,
  /** Bruger/enhed på det aktuelle kald — sættes i beforeEach. */
  userId: "",
  deviceId: "",
  /** Param-værdierne i hvert `timeEntries.findFirst`-opslag. */
  timeEntryLookups: [] as unknown[][],
}));

vi.mock("@/lib/desktop-auth", () => ({
  authenticateDevice: vi.fn(async () => ({
    userId: state.userId,
    deviceId: state.deviceId,
  })),
}));

vi.mock("@/lib/desktop-org", () => ({
  resolveDesktopOrgId: vi.fn(async () => "org-1"),
}));

vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/trpc/trpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/trpc/trpc")>()),
  resolvePlanTier: vi.fn(async () => "solo"),
}));
vi.mock("@/lib/trpc/routers/enterprise/middleware", () => ({
  resolveModules: vi.fn(async () => ({ isEnabled: () => true })),
}));
vi.mock("@/lib/permissions/role-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions/role-access")>()),
  resolveModuleAccess: vi.fn(async () => "write"),
}));

// Ruten har en rigtig grænse på 30 kald pr. minut pr. IP. Den er ikke det
// disse tests handler om, og den gjorde hele filen afhængig af hvor mange
// kald de foregående tests havde brugt (en ny test kunne få de følgende til
// at fejle med 429).
vi.mock("@/lib/desktop-rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "test-ip"),
  rateLimitResponse: vi.fn(
    () =>
      new Response(JSON.stringify({ error: "Rate limited" }), { status: 429 }),
  ),
}));

vi.mock("@/lib/org/period-lock", () => ({
  assertPeriodUnlocked: vi.fn(async () => {}),
}));

vi.mock("@/lib/enterprise/edit-guard", () => ({
  assertEntryEditable: vi.fn(async () => {}),
}));

vi.mock("@/lib/trpc/routers/clientAccess", () => ({
  assertClientAccess: vi.fn(async () => {}),
}));

vi.mock("@/lib/enterprise/period-closing-lock", () => ({
  assertEntriesOutsideClosedPeriods: vi.fn(async () => {}),
}));

vi.mock("@/lib/time/default-billable", () => ({
  resolveDefaultBillable: vi.fn(async () => true),
}));

vi.mock("@/lib/time/task-locks", () => ({
  lockTimeEntryTasks: vi.fn(
    async (_tx, ids: Array<string | null | undefined>) =>
      ids.filter(Boolean).map((id) => ({ id })),
  ),
}));

vi.mock("@/lib/trpc/routers/prepaid", () => ({
  lockPrepaidPackages: vi.fn(async () => {}),
  deductHoursCore: vi.fn(async () => ({
    packageName: "Klipp",
    hoursDeducted: 1,
    remainingHours: 9,
    overflowedToInvoice: false,
  })),
  reversePrepaidUsage: vi.fn(async () => {}),
}));

// Penge-hjælperne kommer fra invoices-routeren; her optager vi kun kaldene, så
// kontrakttesten ikke skal trække hele tRPC-kæden ind.
vi.mock("@/lib/trpc/routers/invoices", () => ({
  releaseEntries: vi.fn(async (_tx: unknown, entryIds: string[]) => {
    state.releasedEntries.push(entryIds);
  }),
  recalcInvoiceTotal: vi.fn(async (_tx: unknown, invoiceId: string) => {
    state.recalcs.push(invoiceId);
  }),
  markEntriesBilled: vi.fn(
    async (_tx: unknown, entryIds: string[], invoiceId: string) => {
      state.billedMarks.push({ entryIds, invoiceId });
      return state.markResult;
    },
  ),
}));

vi.mock("@/lib/db", () => {
  function makeInsert(values: Record<string, unknown>) {
    state.inserted.push(values);
    // Et promise med drizzle-spørgsmålene hængt på, så både
    // `await insert(...)` (sync-loggen) og `insert(...).returning()` virker.
    const query = Promise.resolve() as Promise<unknown> & {
      returning: () => Promise<Record<string, unknown>[]>;
      onConflictDoNothing: (config: unknown) => typeof query;
    };
    query.returning = () =>
      Promise.resolve(
        state.insertHitsConflict ? [] : [{ id: SERVER_ID, ...values }],
      );
    query.onConflictDoNothing = (config) => {
      state.conflictTargets.push(config);
      return query;
    };
    return query;
  }

  function makeDelete(table: unknown) {
    return {
      where: (condition: unknown) => {
        state.deletes.push({ table, params: conditionParams(condition) });
        return Promise.resolve();
      },
    };
  }

  function makeUpdate(values: Record<string, unknown>) {
    state.updates.push(values);
    if (state.concurrent && "hours" in values) {
      Object.assign(state.selectRows[0], values);
    }
    // Både `await update().set().where()` og `.where().returning()` (arkivering
    // tjekker at en række faktisk blev ramt).
    return {
      where: () =>
        Object.assign(Promise.resolve(), {
          returning: () =>
            Promise.resolve(state.archiveHits ? [{ id: SERVER_ID }] : []),
        }),
    };
  }

  /** Param-værdier i et drizzle-condition-træ (eq/and pakker dem i Param). */
  function conditionParams(node: unknown, out: unknown[] = []): unknown[] {
    if (!node || typeof node !== "object") return out;
    const chunk = node as {
      constructor?: { name?: string };
      queryChunks?: unknown[];
    };
    if (chunk.constructor?.name === "Param") {
      out.push((node as { value: unknown }).value);
      return out;
    }
    for (const child of chunk.queryChunks ?? []) {
      conditionParams(child, out);
    }
    return out;
  }

  let queue = Promise.resolve();
  const db = {
    insert: () => ({ values: makeInsert }),
    update: () => ({ set: makeUpdate }),
    select: () => ({
      from: () => ({
        // Rækkerne filtreres på id, så en post der ikke findes på serveren
        // virkelig giver "Entity not found" — ellers ville mocken finde
        // enhver række ved ethvert opslag.
        where: (condition: unknown) => {
          const params = conditionParams(condition);
          const rows = params.includes(SERVER_ID)
            ? state.selectRows
            : state.selectRows.filter((row) => !row.id);
          return Object.assign(
            Promise.resolve(rows.map((row) => ({ ...row }))),
            {
              for: async (mode: string) => {
                expect(mode).toBe("update");
                expect(state.transactionActive).toBe(true);
                state.lockedReads++;
                return rows.map((row) => ({ ...row }));
              },
            },
          );
        },
      }),
    }),
    query: {
      // Referencerne ejes af brugerens org (#750); fremmede id'er dækkes af
      // route.ownership.test.ts.
      projects: { findFirst: async () => ({ id: "owned" }) },
      clients: { findFirst: async () => ({ id: "owned" }) },
      tasks: {
        findFirst: async () => ({
          id: "owned",
          organizationId: "org-1",
          userId: USER,
        }),
      },
      timeEntries: {
        findFirst: async ({ where }: { where: unknown }) => {
          state.timeEntryLookups.push(conditionParams(where));
          if (state.timeEntryRow) return state.timeEntryRow;
          return state.existingOnReplay
            ? { id: state.existingOnReplay }
            : undefined;
        },
      },
      // Ejerskabet på en fakturalinje ligger på forældrefakturaen, så begge
      // opslag skal kunne svare med hhv. linjen og fakturaen (eller undefined
      // for en anden brugers organisation). Linjen slås op på sit id, så et
      // ukendt id skal give undefined — ellers ville mocken finde enhver linje.
      invoiceLines: {
        findFirst: async ({ where }: { where: unknown }) =>
          state.invoiceLine &&
          conditionParams(where).includes(state.invoiceLine.id)
            ? state.invoiceLine
            : undefined,
      },
      invoices: {
        findFirst: async () => state.invoice,
      },
    },
    delete: makeDelete,
    transaction: async (cb: (tx: unknown) => unknown) => {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      state.transactionActive = true;
      try {
        const tx = {
          ...db,
          transaction: async (nested: (tx: unknown) => unknown) => nested(tx),
        };
        return await cb(tx);
      } finally {
        state.transactionActive = false;
        release();
      }
    },
  };
  return { db };
});

const { POST } = await import("./route");
const { timeEntries } = await import("@/lib/db/schema");
const { toCopenhagenDateStr } = await import("@/lib/time/copenhagen");
const { deductHoursCore } = await import("@/lib/trpc/routers/prepaid");

function request(entities: unknown[]): Request {
  return new Request("https://app.timetrack.dk/api/desktop/sync/push", {
    method: "POST",
    headers: { Authorization: "Bearer device-token" },
    body: JSON.stringify({ entities }),
  });
}

function timeEntryValues(): Record<string, unknown> | undefined {
  return state.inserted[0];
}

/** `time_entries.date` er en `timestamp`, så kalenderdagen læses i dansk tid. */
function dateKeyOf(value: unknown): string {
  expect(value).toBeInstanceOf(Date);
  return toCopenhagenDateStr(value as Date);
}

beforeEach(() => {
  state.lockedReads = 0;
  state.concurrent = false;
  state.transactionActive = false;
  state.inserted = [];
  state.updates = [];
  state.deletes = [];
  state.selectRows = [];
  state.conflictTargets = [];
  state.insertHitsConflict = false;
  state.existingOnReplay = null;
  state.timeEntryRow = null;
  state.invoiceLine = null;
  state.invoice = null;
  state.billedMarks = [];
  state.markResult = 1;
  state.archiveHits = true;
  state.releasedEntries = [];
  state.recalcs = [];
  state.userId = USER;
  state.deviceId = DEVICE;
  state.timeEntryLookups = [];
  vi.mocked(deductHoursCore).mockClear();
});

describe("POST /api/desktop/sync/push — create", () => {
  it("afstemmer samtidige ændringer ud fra den låste tidspost", async () => {
    state.concurrent = true;
    state.selectRows = [{ id: SERVER_ID, hours: "1", taskId: "old-task" }];
    const push = () =>
      POST(
        request([
          {
            type: "time_entry",
            action: "update",
            data: { id: SERVER_ID, hours: "2" },
          },
        ]),
      );
    const bodies = await Promise.all(
      [push(), push()].map(async (r) => (await r).json()),
    );
    for (const body of bodies) expect(body.errors).toEqual([]);
    const adjustments = state.updates.filter((row) => "actualMinutes" in row);
    expect(
      adjustments.map(
        (row) => new PgDialect().sqlToQuery(row.actualMinutes as SQL).params[0],
      ),
    ).toEqual([60, 120]);
    expect(state.selectRows[0].hours).toBe("2");
    expect(state.lockedReads).toBe(2);
  });

  it("kontrollerer klientversionen igen efter en samtidig opdatering", async () => {
    state.concurrent = true;
    state.selectRows = [
      {
        id: SERVER_ID,
        hours: "1",
        taskId: "old-task",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];
    const push = () =>
      POST(
        request([
          {
            type: "time_entry",
            action: "update",
            localUpdatedAt: "2026-01-01T00:00:00Z",
            data: { id: SERVER_ID, hours: "2" },
          },
        ]),
      );
    const bodies = await Promise.all(
      [push(), push()].map(async (r) => (await r).json()),
    );
    expect(bodies.flatMap((body) => body.errors)).toEqual([]);
    expect(bodies.flatMap((body) => body.accepted)).toHaveLength(1);
    expect(bodies.flatMap((body) => body.conflicts)).toHaveLength(1);
    expect(state.lockedReads).toBe(2);
  });

  it("justerer begge opgavers minutter ved flytning og ændret timetal", async () => {
    state.selectRows = [{ id: SERVER_ID, hours: "1.25", taskId: "old-task" }];
    const body = await (
      await POST(
        request([
          {
            type: "time_entry",
            action: "update",
            data: {
              id: SERVER_ID,
              hours: "2.5",
              taskId: "44444444-4444-4444-8444-444444444444",
            },
          },
        ]),
      )
    ).json();
    expect(body.errors).toEqual([]);
    const adjustments = state.updates.filter((row) => "actualMinutes" in row);
    expect(adjustments).toHaveLength(2);
    expect(
      adjustments.map(
        (row) => new PgDialect().sqlToQuery(row.actualMinutes as SQL).params,
      ),
    ).toEqual([[75], [150]]);
  });

  it.each([
    [{ hours: "2.5" }, [75, 150]],
    [{ taskId: null }, [75]],
    [{ notes: "Note" }, []],
  ])("justerer opgavetid for patch %j", async (patch, expectedMinutes) => {
    state.selectRows = [{ id: SERVER_ID, hours: "1.25", taskId: "old-task" }];
    const body = await (
      await POST(
        request([
          {
            type: "time_entry",
            action: "update",
            data: { id: SERVER_ID, ...patch },
          },
        ]),
      )
    ).json();
    expect(body.errors).toEqual([]);
    const adjustments = state.updates.filter((row) => "actualMinutes" in row);
    expect(
      adjustments.map(
        (row) => new PgDialect().sqlToQuery(row.actualMinutes as SQL).params[0],
      ),
    ).toEqual(expectedMinutes);
  });

  it("tolker tidsrum uden zone som dansk vægur", async () => {
    const body = await (
      await POST(
        request([
          {
            type: "time_entry",
            action: "create",
            data: {
              startTime: "2026-07-16T23:30:00",
              endTime: "2026-07-17T00:30:00",
            },
          },
        ]),
      )
    ).json();
    expect(body.errors).toEqual([]);
    expect(timeEntryValues()?.startTime).toEqual(
      new Date("2026-07-16T21:30:00Z"),
    );
    expect(timeEntryValues()?.hours).toBe("1.00");
  });
  it("gemmer en post sendt med kun duration og udleder hours + date", async () => {
    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          localId: "lokal-1",
          data: {
            description: "Kundemøde",
            clientId: CLIENT_ID,
            duration: 5400,
            durationUnit: "seconds",
            remoteId: "desktop-cache-id",
          },
        },
      ]),
    );
    const body = await res.json();
    expect(body.errors).toEqual([]);
    const values = timeEntryValues();
    expect(values?.hours).toBe("1.50");
    // Datoen udledes i dansk tid; `now` i testen er ikke relevant her, fordi
    // posten intet har af tidsstempler — den falder på dagens dato.
    // `time_entries.date` er en `timestamp`, så den gemmes som UTC-midnat på
    // den udledede kalenderdag (samme som webbens egen `new Date(input.date)`).
    expect(dateKeyOf(values?.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(values?.date).toBeInstanceOf(Date);
    expect(values?.duration).toBeUndefined();
    expect(values?.remoteId).toBeUndefined();
    expect(values?.userId).toBe(USER);
  });

  it("udleder hours fra startTime/endTime og date fra startTime", async () => {
    await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          data: {
            description: "Udvikling",
            startTime: "2026-09-30T08:00:00Z",
            endTime: "2026-09-30T10:30:00Z",
          },
        },
      ]),
    );
    const values = timeEntryValues();
    expect(values?.hours).toBe("2.50");
    // `date` er UTC-midnat på den danske kalenderdag, `startTime` er et
    // rigtigt Date — ellers kaster drizzle på `value.toISOString`.
    expect(dateKeyOf(values?.date)).toBe("2026-09-30");
    const startTime = values?.startTime;
    expect(startTime).toBeInstanceOf(Date);
    expect((startTime as Date).toISOString()).toBe("2026-09-30T08:00:00.000Z");
    expect(values?.endTime).toBeInstanceOf(Date);
  });

  it("sender tidsstempler som Date, også når appen ekkoer en pullet post", async () => {
    // `pull` sender hele rækken (`db.select()`), så appens lokale db har ISO-
    // strenge i *alle* tidsstempelkolonner. Uden konvertering kaster insertet
    // på `date`, som er NOT NULL — dvs. enhver desktop-registrering fejlede.
    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          data: {
            description: "Udvikling",
            hours: "2.50",
            date: "2026-09-30T00:00:00.000Z",
            startTime: "2026-09-30T08:00:00.000Z",
            endTime: "2026-09-30T10:30:00.000Z",
            createdAt: "2026-09-30T10:31:00.000Z",
            updatedAt: "2026-09-30T10:31:00.000Z",
          },
        },
      ]),
    );
    const body = await res.json();
    expect(body.errors).toEqual([]);
    const values = timeEntryValues();
    for (const field of ["date", "startTime", "endTime", "createdAt"]) {
      expect(values?.[field]).toBeInstanceOf(Date);
    }
    expect(dateKeyOf(values?.date)).toBe("2026-09-30");
  });

  it("sender et klippekorts purchaseDate som Date", async () => {
    const res = await POST(
      request([
        {
          type: "klippekort",
          action: "create",
          data: {
            name: "10 timer",
            totalHours: "10",
            purchaseDate: "2026-09-01T00:00:00.000Z",
          },
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(state.inserted[0]?.purchaseDate).toBeInstanceOf(Date);
  });

  it("sender postens egen kunde til deductHoursCore ved et prepaid-træk (#862, CodeRabbit PR #858)", async () => {
    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          data: {
            description: "Udvikling",
            clientId: CLIENT_ID,
            prepaidPackageId: "pkg-1",
            hours: "1",
            date: "2026-09-30",
          },
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(deductHoursCore).toHaveBeenCalledWith(
      expect.anything(),
      USER,
      expect.anything(),
      expect.objectContaining({ packageId: "pkg-1", clientId: CLIENT_ID }),
    );
  });

  it("returns the deduction appCode alongside the per-entry error", async () => {
    const { appCodeError } = await import("@/lib/trpc/app-code");
    const message = "Not enough hours on the prepaid package";
    vi.mocked(deductHoursCore).mockRejectedValueOnce(
      appCodeError("BAD_REQUEST", "PREPAID_DEDUCTION_FAILED", message),
    );
    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          data: {
            clientId: CLIENT_ID,
            prepaidPackageId: "pkg-1",
            hours: "1",
            date: "2026-09-30",
          },
        },
      ]),
    );
    const body = await res.json();
    expect(body.accepted).toEqual([]);
    expect(body.errors).toEqual([
      expect.objectContaining({
        type: "time_entry",
        error: message,
        appCode: "PREPAID_DEDUCTION_FAILED",
      }),
    ]);
  });

  it("accepterer en kunde uden projekt", async () => {
    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          data: {
            description: "Support",
            clientId: CLIENT_ID,
            hours: "1",
            date: "2026-09-30",
          },
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    expect(timeEntryValues()?.clientId).toBe(CLIENT_ID);
    expect(timeEntryValues()?.projectId).toBeUndefined();
  });

  it("returnerer id-mapping fra lokalt id til server-id", async () => {
    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          localId: "lokal-7",
          data: { description: "Uge 39", hours: "2", date: "2026-09-30" },
        },
      ]),
    );
    const body = await res.json();

    expect(body.idMap).toEqual({ "lokal-7": SERVER_ID });
    expect(body.accepted[0]).toMatchObject({
      localId: "lokal-7",
      remoteId: SERVER_ID,
      action: "create",
    });
  });

  it("lader serveren generere id, så et lokalt SQLite-id ikke gemmes", async () => {
    await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          data: {
            id: "local_42",
            description: "Lokal række",
            hours: "1",
            date: "2026-09-30",
          },
        },
      ]),
    );
    expect(timeEntryValues()).not.toHaveProperty("id");
  });

  it("en gentagelse med samme clientEntryId opretter ikke en dublet", async () => {
    state.insertHitsConflict = true;
    state.existingOnReplay = SERVER_ID;

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          localId: "lokal-9",
          data: {
            description: "Timer",
            hours: "1",
            date: "2026-09-30",
            clientEntryId: "9f6d0f0e-1a2b-4c3d-8e5f-000000000001",
          },
        },
      ]),
    );
    const body = await res.json();

    expect(state.conflictTargets).toHaveLength(1);
    expect(body.errors).toEqual([]);
    expect(body.idMap).toEqual({ "lokal-9": SERVER_ID });
    // Genfindelsen skal bruge præcis den værdi der blev gemt, ellers ville
    // gentagelsen svare med en anden posts id (eller ingen).
    expect(timeEntryValues()?.clientEntryId).toBe(
      "9f6d0f0e-1a2b-4c3d-8e5f-000000000001",
    );
    expect(state.timeEntryLookups[0]).toEqual([
      "9f6d0f0e-1a2b-4c3d-8e5f-000000000001",
      USER,
    ]);
  });

  it("lagrer en lokal nøgle i et navne rum pr. bruger og enhed", async () => {
    // Skrivebordsappen sender sit lokale SQLite-rækkenummer, som kun er
    // unikt på den ene enhed, mens kolonnen er UNIQUE for hele tabellen.
    // Uden et navne rum pr. bruger og enhed kunne to brugere (eller to
    // enheder) med samme lokale id aldrig oprette hver sin post.
    const local = (value: string) => [
      {
        type: "time_entry",
        action: "create",
        localId: "lokal-42",
        data: {
          description: "Lokal post",
          hours: "1",
          date: "2026-09-30",
          clientEntryId: value,
        },
      },
    ];

    const first = await POST(request(local("42")));
    const firstBody = await first.json();
    const firstKey = timeEntryValues()?.clientEntryId;

    expect(firstBody.errors).toEqual([]);
    expect(String(firstKey)).toMatch(/^c[\w-]{22}$/);

    // Samme lokale id fra en anden enhed hos samme bruger.
    state.inserted = [];
    state.deviceId = "device-2";
    const second = await POST(request(local("42")));
    const secondBody = await second.json();
    const secondKey = timeEntryValues()?.clientEntryId;

    expect(secondBody.errors).toEqual([]);
    expect(secondKey).not.toBe(firstKey);

    // Og fra en anden bruger.
    state.inserted = [];
    state.userId = "user-2";
    state.deviceId = DEVICE;
    const third = await POST(request(local("42")));
    const thirdBody = await third.json();

    expect(thirdBody.errors).toEqual([]);
    expect(timeEntryValues()?.clientEntryId).not.toBe(firstKey);
    expect(timeEntryValues()?.clientEntryId).not.toBe(secondKey);
  });

  it("genfinder den afledte nølle, når indsættelsen rammer indekset", async () => {
    // Gentagelsen efter et tabt svar skal finde præcis den række, der blev
    // gemt under den afledte nøgle — ellers ville appen tro posten aldrig
    // blev oprettet (eller få en anden enheds id).
    state.insertHitsConflict = true;
    state.existingOnReplay = SERVER_ID;

    await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          localId: "lokal-42",
          data: {
            description: "Timer",
            hours: "1",
            date: "2026-09-30",
            clientEntryId: "42",
          },
        },
      ]),
    );

    const stored = timeEntryValues()?.clientEntryId;
    expect(state.conflictTargets).toHaveLength(1);
    expect(state.timeEntryLookups[0]).toEqual([stored, USER]);
  });

  it("gemmer ingen rå nøgle, appen ikke kan genfinde", async () => {
    // En nøgle der ikke kan bruges (for lang til varchar(36)) ville først
    // stå rå i kolonnen og fejle selve indsættelsen.
    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          data: {
            description: "Timer",
            hours: "1",
            date: "2026-09-30",
            clientEntryId: "x".repeat(64),
          },
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(timeEntryValues()).not.toHaveProperty("clientEntryId");
    expect(state.conflictTargets).toHaveLength(0);
  });

  it("sender ikke idempotensnøglen med i en kunde-post", async () => {
    // Kolonnen findes kun på `time_entries`, så en nøgle på en kunde ville
    // fejle hele posten på en ukendt kolonne.
    const res = await POST(
      request([
        {
          type: "client",
          action: "create",
          data: { name: "Kunde A", clientEntryId: "42" },
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(timeEntryValues()).not.toHaveProperty("clientEntryId");
  });

  it("læser en dato som dansk vægur uden zone på sin egen dag", async () => {
    // `new Date("…T23:30:00")` ville under TZ=UTC give 23:30Z = 17/7 dansk.
    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          data: { hours: "1", date: "2026-07-16T23:30:00" },
        },
      ]),
    );
    expect((await res.json()).errors).toEqual([]);
    const date = timeEntryValues()?.date;
    expect(date).toBeInstanceOf(Date);
    expect((date as Date).toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("en post uden timetal og uden tidsstempler fejler tydeligt pr. post", async () => {
    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          localId: "lokal-fejl",
          data: { description: "Uden tidsdata" },
        },
      ]),
    );
    const body = await res.json();

    expect(body.accepted).toEqual([]);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({
      localId: "lokal-fejl",
      type: "time_entry",
    });
    expect(body.errors[0].error).toMatch(/udlede timetal/);
  });
});

describe("POST /api/desktop/sync/push — update og delete", () => {
  it("opdaterer en post og gemmer de afsendte felter", async () => {
    state.selectRows = [
      {
        id: SERVER_ID,
        userId: USER,
        hours: "1.00",
        date: new Date("2026-09-30T00:00:00Z"),
        clientId: CLIENT_ID,
        isPrepaid: false,
        prepaidPackageId: null,
        updatedAt: new Date("2026-09-01T00:00:00Z"),
      },
    ];

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "update",
          data: { id: SERVER_ID, hours: "2.5" },
          localUpdatedAt: "2026-09-30T10:00:00Z",
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(body.accepted[0]).toMatchObject({
      remoteId: SERVER_ID,
      action: "update",
    });
    expect(state.updates.some((u) => u.hours === "2.5")).toBe(true);
  });

  it("lader en update ikke flytte posten til en anden organisation", async () => {
    state.selectRows = [
      {
        id: SERVER_ID,
        userId: USER,
        hours: "1.00",
        date: new Date("2026-09-30T00:00:00Z"),
        clientId: CLIENT_ID,
        isPrepaid: false,
        prepaidPackageId: null,
        updatedAt: new Date("2026-09-01T00:00:00Z"),
      },
    ];

    await POST(
      request([
        {
          type: "time_entry",
          action: "update",
          data: { id: SERVER_ID, hours: "2.5", organizationId: "fremmed-org" },
          localUpdatedAt: "2026-09-30T10:00:00Z",
        },
      ]),
    );

    const applied = state.updates.find((u) => u.hours === "2.5");
    expect(applied).toBeDefined();
    expect(applied).not.toHaveProperty("organizationId");
  });

  it("skriver kun en tombstone når arkiveringen ramte en egen række", async () => {
    const tombstones = () =>
      state.inserted.filter(
        (v) => v.entityType === "client" && !("deviceId" in v),
      );

    const own = await (
      await POST(
        request([
          { type: "client", action: "delete", data: { id: SERVER_ID } },
        ]),
      )
    ).json();
    expect(own.errors).toEqual([]);
    expect(tombstones()).toHaveLength(1);

    state.inserted = [];
    state.archiveHits = false; // en kollegas eller et ukendt id
    const foreign = await (
      await POST(
        request([
          { type: "client", action: "delete", data: { id: SERVER_ID } },
        ]),
      )
    ).json();
    expect(foreign.errors).toHaveLength(1);
    expect(tombstones()).toHaveLength(0);
  });

  it("lader en update ikke overskrive idempotensnøglen", async () => {
    // Nøglen afledes på create (bruger + enhed). Skrev en update appens rå
    // lokale nøgle, ville posten ramme det globale unique-indeks ved næste
    // gentagelse og ikke kunne genfindes, fordi opslaget leder på den
    // afledte værdi.
    state.selectRows = [
      {
        id: SERVER_ID,
        userId: USER,
        hours: "1.00",
        date: new Date("2026-09-30T00:00:00Z"),
        clientId: CLIENT_ID,
        isPrepaid: false,
        prepaidPackageId: null,
        updatedAt: new Date("2026-09-01T00:00:00Z"),
      },
    ];

    await POST(
      request([
        {
          type: "time_entry",
          action: "update",
          data: { id: SERVER_ID, hours: "2.5", clientEntryId: "42" },
          localUpdatedAt: "2026-09-30T10:00:00Z",
        },
      ]),
    );

    // Den første update i et kald er enhedens `lastSyncAt`.
    expect(state.updates).toHaveLength(2);
    const applied = state.updates.find((u) => u.hours === "2.5");
    expect(applied).toBeDefined();
    expect(applied).not.toHaveProperty("clientEntryId");
  });

  it("serveren vinder ved en nyere updatedAt og returnerer en konflikt", async () => {
    state.selectRows = [
      {
        id: SERVER_ID,
        userId: USER,
        hours: "1.00",
        date: new Date("2026-09-30T00:00:00Z"),
        clientId: CLIENT_ID,
        isPrepaid: false,
        updatedAt: new Date("2026-09-30T12:00:00Z"),
      },
    ];

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "update",
          data: { id: SERVER_ID, hours: "2.5" },
          localUpdatedAt: "2026-09-30T10:00:00Z",
        },
      ]),
    );
    const body = await res.json();

    expect(body.accepted).toEqual([]);
    expect(body.conflicts[0]).toMatchObject({
      remoteId: SERVER_ID,
      reason: "Server version is newer",
    });
    expect(body.conflicts[0].serverData.hours).toBe("1.00");
  });

  it("sletter en tidspost hard og skriver en tombstone", async () => {
    state.timeEntryRow = {
      id: SERVER_ID,
      userId: USER,
      taskId: null,
      isPrepaid: false,
      prepaidPackageId: null,
      hours: "2.00",
    };

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "delete",
          data: { id: SERVER_ID },
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(body.accepted[0]).toMatchObject({
      remoteId: SERVER_ID,
      action: "delete",
    });
    // time_entries har ingen is_archived — ruten sletter rækken, som tRPC gør.
    expect(state.updates).not.toContainEqual(
      expect.objectContaining({ isArchived: true }),
    );
    expect(state.deletes.map((d) => d.table)).toContain(timeEntries);
    expect(
      state.inserted.find((row) => row.entityType === "time_entry"),
    ).toMatchObject({
      entityId: SERVER_ID,
      userId: USER,
      organizationId: "org-1",
    });
  });

  it("frigiver klippektid og opgavetid ved sletningen", async () => {
    state.timeEntryRow = {
      id: SERVER_ID,
      userId: USER,
      taskId: "task-1",
      isPrepaid: true,
      prepaidPackageId: "pkg-1",
      hours: "1.50",
    };

    const res = await POST(
      request([
        { type: "time_entry", action: "delete", data: { id: SERVER_ID } },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    const { reversePrepaidUsage } = await import("@/lib/trpc/routers/prepaid");
    expect(reversePrepaidUsage).toHaveBeenCalledWith(
      expect.anything(),
      SERVER_ID,
      "pkg-1",
    );
    expect(state.updates).toContainEqual(
      expect.objectContaining({ updatedAt: expect.any(Date) }),
    );
  });

  it("sletter ikke en tidspost der tilhører en anden bruger", async () => {
    state.timeEntryRow = null;

    const res = await POST(
      request([
        { type: "time_entry", action: "delete", data: { id: SERVER_ID } },
      ]),
    );
    const body = await res.json();

    expect(body.accepted).toEqual([]);
    expect(body.errors[0]).toMatchObject({
      index: 0,
      type: "time_entry",
      action: "delete",
    });
    expect(body.errors[0].error).toMatch(/findes ikke/);
    expect(state.deletes.map((d) => d.table)).not.toContain(timeEntries);
  });

  it("melder tydeligt at en type uden arkiveringskolonne ikke kan slettes", async () => {
    const res = await POST(
      request([{ type: "project", action: "delete", data: { id: SERVER_ID } }]),
    );
    const body = await res.json();

    expect(body.accepted).toEqual([]);
    expect(body.errors[0].error).toMatch(/not supported/);
    // projects har ingen is_archived — en UPDATE ville være en ugyldig SQL-sætning.
    expect(state.updates).not.toContainEqual(
      expect.objectContaining({ isArchived: true }),
    );
  });
});

describe("POST /api/desktop/sync/push — remoteId som server-id", () => {
  const existingRow = {
    id: SERVER_ID,
    userId: USER,
    hours: "1.00",
    date: new Date("2026-09-30T00:00:00Z"),
    clientId: CLIENT_ID,
    isPrepaid: false,
    prepaidPackageId: null,
    updatedAt: new Date("2026-09-01T00:00:00Z"),
  };

  it("opdaterer en post der kun har remoteId", async () => {
    state.selectRows = [existingRow];

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "update",
          localId: "lokal-11",
          data: { remoteId: SERVER_ID, hours: "3.5" },
          localUpdatedAt: "2026-09-30T10:00:00Z",
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(body.accepted[0]).toMatchObject({
      localId: "lokal-11",
      remoteId: SERVER_ID,
      action: "update",
    });
    expect(state.updates.some((u) => u.hours === "3.5")).toBe(true);
  });

  it("skriver ikke remoteId eller duration som kolonner ved en update", async () => {
    state.selectRows = [existingRow];

    await POST(
      request([
        {
          type: "time_entry",
          action: "update",
          data: {
            remoteId: SERVER_ID,
            hours: "3.5",
            duration: 12600,
            durationUnit: "seconds",
          },
          localUpdatedAt: "2026-09-30T10:00:00Z",
        },
      ]),
    );

    const applied = state.updates.find((u) => u.hours === "3.5");
    expect(applied).toBeDefined();
    expect(applied).not.toHaveProperty("remoteId");
    expect(applied).not.toHaveProperty("duration");
    expect(applied).not.toHaveProperty("durationUnit");
  });

  it("sletter en post der kun har remoteId", async () => {
    state.timeEntryRow = {
      id: SERVER_ID,
      userId: USER,
      taskId: null,
      isPrepaid: false,
      prepaidPackageId: null,
      hours: "1.00",
    };

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "delete",
          data: { remoteId: SERVER_ID },
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(body.accepted[0]).toMatchObject({
      remoteId: SERVER_ID,
      action: "delete",
    });
  });

  it("sætter timetallet når appen kun flytter tidsrummet", async () => {
    state.selectRows = [existingRow];

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "update",
          data: {
            id: SERVER_ID,
            startTime: "2026-09-30T08:00:00Z",
            endTime: "2026-09-30T11:00:00Z",
          },
          localUpdatedAt: "2026-09-30T10:00:00Z",
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    const applied = state.updates.find((u) => u.hours === "3.00");
    expect(applied).toBeDefined();
    // Datoen flyttes aldrig ved en update — kun appen må det.
    expect(applied).not.toHaveProperty("date");
  });

  it("lader en update uden tidsdata stå uændret", async () => {
    state.selectRows = [existingRow];

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "update",
          data: { id: SERVER_ID, description: "Ny tekst" },
          localUpdatedAt: "2026-09-30T10:00:00Z",
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    const applied = state.updates.find((u) => u.description === "Ny tekst");
    expect(applied).toBeDefined();
    expect(applied).not.toHaveProperty("hours");
  });

  it("skriver tidsstempler som Date i update-vejen", async () => {
    state.selectRows = [existingRow];

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "update",
          data: {
            id: SERVER_ID,
            date: "2026-10-01T00:00:00.000Z",
            startTime: "2026-10-01T08:00:00.000Z",
            endTime: "2026-10-01T12:00:00.000Z",
          },
          localUpdatedAt: "2026-09-30T10:00:00Z",
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    const applied = state.updates.find((u) => u.hours === "4.00");
    expect(applied).toBeDefined();
    for (const field of ["date", "startTime", "endTime"]) {
      expect(applied?.[field]).toBeInstanceOf(Date);
    }
    expect(dateKeyOf(applied?.date)).toBe("2026-10-01");
  });
});

describe("POST /api/desktop/sync/push — fejl pr. post", () => {
  it("beholder de gyldige poster, når én post i batchen er ugyldig", async () => {
    state.selectRows = [
      {
        id: SERVER_ID,
        userId: USER,
        hours: "1.00",
        date: new Date("2026-09-30T00:00:00Z"),
        clientId: CLIENT_ID,
        isPrepaid: false,
        updatedAt: new Date("2026-09-01T00:00:00Z"),
      },
    ];

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          localId: "lokal-1",
          data: { description: "Rettet post", hours: "1", date: "2026-09-30" },
        },
        {
          type: "time_entry",
          action: "update",
          data: { id: "findes-ikke", hours: "2" },
        },
        {
          type: "time_entry",
          action: "update",
          localId: "lokal-2",
          data: { id: SERVER_ID, hours: "4" },
        },
      ]),
    );
    const body = await res.json();

    expect(body.accepted.map((a: { action: string }) => a.action)).toEqual([
      "create",
      "update",
    ]);
    expect(body.idMap).toEqual({ "lokal-1": SERVER_ID });
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({
      index: 1,
      type: "time_entry",
      action: "update",
      remoteId: "findes-ikke",
    });
    expect(body.errors[0].error).toMatch(/Entity not found/);
  });

  it("peger på den ugyldige post via index, selv uden localId", async () => {
    const res = await POST(
      request([{ type: "hold_vægt", action: "create", data: {} }]),
    );
    const body = await res.json();

    expect(body.errors[0]).toMatchObject({
      index: 0,
      type: "hold_vægt",
    });
  });

  it("overlever en enhed der ikke er et objekt", async () => {
    const res = await POST(
      request([
        null,
        {
          type: "time_entry",
          action: "create",
          localId: "l-1",
          data: { hours: "1", date: "2026-09-30" },
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors[0]).toMatchObject({ index: 0 });
    expect(body.accepted).toHaveLength(1);
  });
});

describe("POST /api/desktop/sync/push — ejerskab på fakturalinjer", () => {
  const LINE_ID = "33333333-3333-3333-3333-333333333333";
  const INVOICE_ID = "44444444-4444-4444-4444-444444444444";
  const TIME_ENTRY_ID = "55555555-5555-5555-5555-555555555555";

  /** En linje på egen (org'ens) kladdefaktura. */
  function givenOwnDraftLine() {
    state.invoiceLine = {
      id: LINE_ID,
      invoiceId: INVOICE_ID,
      timeEntryId: TIME_ENTRY_ID,
    };
    state.invoice = {
      id: INVOICE_ID,
      status: "draft",
      organizationId: "org-1",
    };
  }

  it("sletter ikke en fakturalinje i en anden organisation", async () => {
    state.invoiceLine = {
      id: LINE_ID,
      invoiceId: INVOICE_ID,
      timeEntryId: null,
    };
    // Forældrefakturaen tilhører en anden org → ejerskabsopslaget finder intet.
    state.invoice = null;

    const res = await POST(
      request([
        { type: "invoice_line", action: "delete", data: { id: LINE_ID } },
      ]),
    );
    const body = await res.json();

    expect(body.accepted).toEqual([]);
    expect(body.errors[0]).toMatchObject({
      type: "invoice_line",
      action: "delete",
    });
    expect(state.deletes).toEqual([]);
  });

  it("sletter ikke en linje på en sendt faktura", async () => {
    state.invoiceLine = {
      id: LINE_ID,
      invoiceId: INVOICE_ID,
      timeEntryId: null,
    };
    state.invoice = { id: INVOICE_ID, status: "sent", organizationId: "org-1" };

    const res = await POST(
      request([
        { type: "invoice_line", action: "delete", data: { id: LINE_ID } },
      ]),
    );
    const body = await res.json();

    expect(body.accepted).toEqual([]);
    expect(body.errors[0].error).toMatch(/kladde-fakturaer/);
    expect(state.deletes).toEqual([]);
  });

  it("sletter en linje på egen kladdefaktura, frigiver tiden og genberegner totalet", async () => {
    givenOwnDraftLine();

    const res = await POST(
      request([
        { type: "invoice_line", action: "delete", data: { id: LINE_ID } },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(body.accepted[0]).toMatchObject({
      remoteId: LINE_ID,
      type: "invoice_line",
      action: "delete",
    });
    // Slettet på præcis denne linje, ikke på hele tabellen.
    expect(state.deletes).toHaveLength(1);
    expect(state.deletes[0].params).toContain(LINE_ID);
    // Tidsposten skal kunne faktureres igen, ellers står den faktureret uden
    // nogen linje.
    expect(state.releasedEntries).toEqual([[TIME_ENTRY_ID]]);
    // invoices.amount er den eneste måde totalet sættes på.
    expect(state.recalcs).toEqual([INVOICE_ID]);
  });

  it("opdaterer ikke en fakturalinje i en anden organisation", async () => {
    // Linjen ligger på SERVER_ID, så den generiske select-forklaring (som
    // kun svarer på det id) ville fundet rækken. Uden ejerskabskontrollen ville
    // den gamle kode derfor skrive beløbet på linjen — det er præcis hullet.
    state.invoiceLine = {
      id: SERVER_ID,
      invoiceId: INVOICE_ID,
      timeEntryId: null,
    };
    state.invoice = null;
    state.selectRows = [
      { id: SERVER_ID, invoiceId: INVOICE_ID, amount: "100.00" },
    ];

    const res = await POST(
      request([
        {
          type: "invoice_line",
          action: "update",
          data: { id: SERVER_ID, amount: "999.00" },
        },
      ]),
    );
    const body = await res.json();

    expect(body.accepted).toEqual([]);
    expect(state.updates.some((u) => u.amount === "999.00")).toBe(false);
    expect(state.recalcs).toEqual([]);
  });

  it("opdaterer en linje på egen kladdefaktura og genberegner totalet", async () => {
    givenOwnDraftLine();

    const res = await POST(
      request([
        {
          type: "invoice_line",
          action: "update",
          data: { id: LINE_ID, amount: "250.00" },
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(body.accepted[0]).toMatchObject({
      remoteId: LINE_ID,
      action: "update",
    });
    expect(state.updates.some((u) => u.amount === "250.00")).toBe(true);
    expect(state.recalcs).toEqual([INVOICE_ID]);
  });

  it("flytter ikke en linje til en anden faktura via invoiceId", async () => {
    givenOwnDraftLine();

    await POST(
      request([
        {
          type: "invoice_line",
          action: "update",
          data: {
            id: LINE_ID,
            amount: "250.00",
            // Uden felt-whitelist kunne appen godkende linjen mod sin egen
            // faktura og flytte den til en fremmende.
            invoiceId: "66666666-6666-6666-6666-666666666666",
            timeEntryId: "77777777-7777-7777-7777-777777777777",
          },
        },
      ]),
    );

    const applied = state.updates.find((u) => u.amount === "250.00");
    expect(applied).toBeDefined();
    expect(applied).not.toHaveProperty("invoiceId");
    expect(applied).not.toHaveProperty("timeEntryId");
  });

  it("lader en gyldig linje være på, selv når en fremmed linje fejler", async () => {
    givenOwnDraftLine();

    const res = await POST(
      request([
        // En linje der slet ikke findes på serveren.
        {
          type: "invoice_line",
          action: "delete",
          data: { id: "99999999-9999-9999-9999-999999999999" },
        },
        { type: "invoice_line", action: "delete", data: { id: LINE_ID } },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toHaveLength(1);
    expect(body.accepted).toHaveLength(1);
    expect(state.deletes).toHaveLength(1);
  });
});

describe("POST /api/desktop/sync/push — oprettelse af fakturalinjer", () => {
  const INVOICE_ID = "44444444-4444-4444-4444-444444444444";
  const TIME_ENTRY_ID = "55555555-5555-5555-5555-555555555555";

  function createLine(data: Record<string, unknown>) {
    return POST(
      request([
        {
          type: "invoice_line",
          action: "create",
          localId: "linje-1",
          data: {
            invoiceId: INVOICE_ID,
            description: "Udvikling",
            quantity: "2",
            unitPrice: "800",
            amount: "1600",
            ...data,
          },
        },
      ]),
    );
  }

  it("opretter ikke en linje på en faktura i en anden organisation", async () => {
    state.invoice = null; // ejerskabsopslaget finder intet
    const body = await (await createLine({})).json();

    expect(body.errors).toHaveLength(1);
    expect(body.accepted).toHaveLength(0);
    expect(state.inserted).toHaveLength(0);
    expect(state.billedMarks).toHaveLength(0);
  });

  it("opretter ikke en linje på en sendt faktura", async () => {
    state.invoice = { id: INVOICE_ID, status: "sent", organizationId: "org-1" };
    const body = await (await createLine({})).json();

    expect(body.errors).toHaveLength(1);
    expect(state.inserted).toHaveLength(0);
  });

  it("opretter på egen kladde, markerer tidsposten og genberegner totalen", async () => {
    state.invoice = {
      id: INVOICE_ID,
      status: "draft",
      organizationId: "org-1",
    };
    const body = await (
      await createLine({
        timeEntryId: TIME_ENTRY_ID,
        organizationId: "fremmed",
      })
    ).json();

    expect(body.errors).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    expect(state.billedMarks).toEqual([
      { entryIds: [TIME_ENTRY_ID], invoiceId: INVOICE_ID },
    ]);
    expect(state.recalcs).toEqual([INVOICE_ID]);
    const line = state.inserted[0];
    expect(line).toMatchObject({
      invoiceId: INVOICE_ID,
      timeEntryId: TIME_ENTRY_ID,
      amount: "1600",
    });
    expect(line).not.toHaveProperty("organizationId");
  });

  it("afviser en tidspost der ikke kan faktureres (fremmed eller faktureret)", async () => {
    state.invoice = {
      id: INVOICE_ID,
      status: "draft",
      organizationId: "org-1",
    };
    state.markResult = 0;
    const body = await (
      await createLine({ timeEntryId: TIME_ENTRY_ID })
    ).json();

    expect(body.errors).toHaveLength(1);
    expect(state.recalcs).toHaveLength(0);
  });
});

describe("POST /api/desktop/sync/push — svaret skal kunne afkodes af appen", () => {
  // Appens `AcceptedEntity`/`ConflictEntity` kræver `localId` som en streng,
  // og serdes afkodning fejler for hele `PushResponse` på en manglende felt —
  // også for de poster serveren har committet. Appen ville så prøve igen for
  // evigt, og uden idempotensnøgle bliver hver gentagelse en ny dublet.

  it("svarer med en nøgle på en create der ikke sendte et localId", async () => {
    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          data: {
            description: "Uden lokal nøgle",
            hours: "1",
            date: "2026-09-30",
          },
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(body.accepted).toHaveLength(1);
    expect(typeof body.accepted[0].localId).toBe("string");
    expect(body.accepted[0].localId).not.toBe("");
  });

  it("falder tilbage på rækken's eget id, når appen ikke sender en nøgle", async () => {
    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          data: {
            id: "lokal-42",
            description: "Lokal række",
            hours: "1",
            date: "2026-09-30",
          },
        },
      ]),
    );
    const body = await res.json();

    expect(body.accepted[0].localId).toBe("lokal-42");
  });

  it("svarer med en nøgle på en konflikt der ikke sendte et localId", async () => {
    state.selectRows = [
      {
        id: SERVER_ID,
        userId: USER,
        hours: "1.00",
        date: new Date("2026-09-30T00:00:00Z"),
        clientId: CLIENT_ID,
        isPrepaid: false,
        updatedAt: new Date("2026-09-30T12:00:00Z"),
      },
    ];

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "update",
          data: { id: SERVER_ID, hours: "2.5" },
          localUpdatedAt: "2026-09-30T10:00:00Z",
        },
      ]),
    );
    const body = await res.json();

    expect(body.conflicts[0].localId).toBe(SERVER_ID);
    expect(body.conflicts[0].serverData).toBeDefined();
  });

  it("giver hver post i batchen en nøgle, også når appen slet ikke sender nogen", async () => {
    state.timeEntryRow = {
      id: SERVER_ID,
      userId: USER,
      taskId: null,
      isPrepaid: false,
      prepaidPackageId: null,
      hours: "1.00",
    };

    const res = await POST(
      request([
        {
          type: "time_entry",
          action: "create",
          localId: "lokal-1",
          data: { description: "A", hours: "1", date: "2026-09-30" },
        },
        {
          type: "time_entry",
          action: "delete",
          data: { id: SERVER_ID },
        },
      ]),
    );
    const body = await res.json();

    expect(body.errors).toEqual([]);
    expect(body.accepted).toHaveLength(2);
    for (const entry of body.accepted) {
      expect(typeof entry.localId).toBe("string");
      expect(entry.localId).not.toBe("");
    }
    expect(
      new Set(body.accepted.map((a: { localId: string }) => a.localId)).size,
    ).toBe(2);
  });
});
