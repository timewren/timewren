/**
 * `time_entries.date` skal være UTC-midnat på den danske kalenderdag, uanset
 * hvilken form klienten sender dagen i (#650).
 *
 * Før denne rettelse skrev `time.create`/`time.update`/CSV-import/extension
 * `new Date(input.date)` — altså `new Date(streng)`. Det gav tre forskellige
 * fejl alt efter hvad klienten sendte:
 *
 * - `"2026-07-16T22:30:00.000Z"` blev gemt **råt**, altså 22:30Z. Posten lå
 *   da uden for `todayTotal`s vindue (dag-end er 00:00Z) og i næste døgns
 *   række, selv om den danske dag var 16/7.
 * - `2026-07-16T22:30` (værkur uden zone) blev læst som UTC = 20:30Z, så
 *   kalenderdagen 16/7 blev 17/7.
 * - `"2026-02-31"` rullede stædende over til 3. marts, og `"16.07.2026"` gav
 *   `Invalid Date`, hvor drizzle kastede ved `toISOString()` — altså 500 for
 *   hele mutationen i stedet for en 400.
 *
 * Testen læser de værdier, routeren giver insertet i `time_entries`, så den
 * kan ikke være grøn mens routeren skriver noget andet end UTC-midnat.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ingen tvungen TZ: CI kører filen både med TZ=UTC og TZ=Europe/Copenhagen,
// og resultatet må ikke afhænge af processens tidszone.

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
// Aktivt medlemskab: uden org afviser isAuthed kaldet.
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => "org-test"),
}));
vi.mock("../enterprise/middleware", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../enterprise/middleware")>()),
  resolveModules: vi.fn(async () => ({
    raw: new Map(),
    isAvailable: () => true,
    isEnabled: () => true,
  })),
}));
vi.mock("@/lib/desktop-sync-tombstones", () => ({
  recordSyncTombstone: vi.fn(async () => {}),
  recordDeletionTombstones: vi.fn(async () => {}),
}));
// Bivirkninger af en vellykket create — ikke det testen måler, og de
// rører den importerede `db` (ikke ctx.db), som stubben ikke dækker.
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/email/engagement", () => ({
  sendFirstTimeEntryEmail: vi.fn(async () => {}),
}));
vi.mock("@/lib/email/prepaid", () => ({
  checkAndSendLowBalanceAlert: vi.fn(async () => {}),
}));
vi.mock("@/lib/webhooks/events", () => ({
  emitWebhookEvent: vi.fn(async () => {}),
}));

import { getTableName } from "drizzle-orm";
import { timeRouter } from "../time";

const USER = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

/**
 * db-mock der gemmer hvert insert i `time_entries` som de værdier, routeren
 * skriver — altså det præcis, `mapToDriverValue` ville sende til Postgres.
 *
 * Den er bevidst en stub frem for en rigtig drizzle-builder: det vi vil se er
 * typen og værdien af `values.date`, og en `Date` i stedet for en streng er
 * lige så synlig her som i `toSQL()`.
 */
function makeDb(
  options: {
    rows?: Record<string, unknown>[];
    /** Rækker pr. tabel, som `db.query.*.find*` svarer med. */
    tables?: Record<
      string,
      Record<string, unknown> | Record<string, unknown>[]
    >;
  } = {},
) {
  const inserts: Record<string, unknown>[] = [];
  const rows = () => options.rows ?? [];

  /** Find-first der svarer med det, testen har sat op for den tabel. */
  const findFirst = (table: string) => async () => {
    const hit = options.tables?.[table];
    if (Array.isArray(hit)) return hit[0] ?? null;
    return hit ?? null;
  };
  const findMany = (table: string) => async () => {
    const hit = options.tables?.[table];
    if (Array.isArray(hit)) return hit;
    return hit ? [hit] : [];
  };

  const chain: Record<string, unknown> = {};
  chain.insert = () => chain;
  chain.values = () => chain;
  chain.set = () => chain;
  chain.from = () => chain;
  chain.where = () => chain;
  chain.for = () => chain;
  chain.limit = () => chain;
  chain.offset = () => chain;
  chain.orderBy = () => chain;
  chain.groupBy = () => chain;
  chain.returning = async () => rows();
  // biome-ignore lint/suspicious/noThenProperty: bevidst thenable db-builder
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(rows()).then(resolve);

  const db = {
    select: () => chain,
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        if (isTimeEntries(table)) {
          const list = Array.isArray(values) ? values : [values];
          for (const entry of list) {
            inserts.push(entry as Record<string, unknown>);
          }
        }
        // En rigtig drizzle-builder er BÅDE awaitbar og fortsættelig, så
        // `.values(...).returning()` og `await ....values(...)` virker begge.
        const builder: Record<string, unknown> = {
          returning: async () => rows(),
          onConflictDoNothing: () => builder,
        };
        // biome-ignore lint/suspicious/noThenProperty: bevidst thenable builder
        builder.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve(rows()).then(resolve);
        return builder;
      },
    }),
    update: () => ({ set: () => chain }),
    // `time.create` skriver i en transaction; stubben kører callbacken med
    // sig selv, hvilket er nok for at nå `.insert().values()`.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    // Alle tabeller svarer med det, testen har sat op (ellers tomt), så
    // org-stierne (medlemskab, periodelås …) kan køre uden en stub pr. tabel.
    query: new Proxy(
      {},
      {
        get: (_target, table) => ({
          findFirst: findFirst(String(table)),
          findMany: findMany(String(table)),
        }),
      },
    ),
  };
  return { db, inserts };
}

function caller(db: unknown) {
  return {
    db,
    headers: new Headers(),
    session: { user: { id: USER } },
  } as never;
}

/** ISO-strengen Postgres ville modtage for `values.date`. */
function storedDate(values: Record<string, unknown>): string {
  const date = values.date;
  if (!(date instanceof Date)) {
    throw new Error(
      `date blev skrevet som ${typeof date} (${JSON.stringify(date)}), ikke et Date`,
    );
  }
  return date.toISOString();
}

/** Drizzle-tabellens JS-navn — robust mod at tabellen er et andet objekt. */
function isTimeEntries(table: unknown): boolean {
  try {
    return getTableName(table as never) === "time_entries";
  } catch {
    return false;
  }
}

const SUBSCRIPTION = { id: "sub", userId: USER, status: "active" };
/** Den række `.returning()` svarer med efter et insert. */
const SAVED_ENTRY = {
  id: "33333333-3333-4333-8333-333333333333",
  userId: USER,
  projectId: PROJECT,
  clientId: null,
  description: "",
  date: new Date("2026-07-16T00:00:00.000Z"),
  hours: "2",
};
const PROJECT_ROW = {
  id: PROJECT,
  name: "Rådgivning",
  hourlyRate: null,
  clientId: null,
};

/** Minimums-tabeller `time.create` og `time.bulkImport` spørger efter. */
function baseTables(overrides: Record<string, unknown> = {}) {
  return {
    subscriptions: SUBSCRIPTION,
    projects: PROJECT_ROW,
    users: { defaultHourlyRate: null },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("time.create lægger `date` på den danske dag", () => {
  it("tager en ren kalenderdato bogstaveligt", async () => {
    const { db, inserts } = makeDb({
      rows: [SAVED_ENTRY],
      tables: baseTables(),
    });

    await timeRouter.createCaller(caller(db)).create({
      projectId: PROJECT,
      description: "Råd på den danske dag",
      hours: 2,
      date: "2026-07-16",
    });

    expect(storedDate(inserts[0])).toBe("2026-07-16T00:00:00.000Z");
  });

  it("læser et tidspunkt med zone på den danske dag det falder på", async () => {
    const { db, inserts } = makeDb({
      rows: [SAVED_ENTRY],
      tables: baseTables(),
    });

    await timeRouter.createCaller(caller(db)).create({
      projectId: PROJECT,
      description: "Stop kl. 00:30 dansk tid",
      hours: 2,
      // 22:30Z = 00:30 dansk tid 16/7. Råt gemt var det 22:30Z, som ligger
      // uden for dagens vindue (slutter 17/7 00:00Z).
      date: "2026-07-15T22:30:00.000Z",
    });

    expect(storedDate(inserts[0])).toBe("2026-07-16T00:00:00.000Z");
  });

  it("læser dansk værkur som dansk tid, ikke som UTC", async () => {
    const { db, inserts } = makeDb({
      rows: [SAVED_ENTRY],
      tables: baseTables(),
    });

    await timeRouter.createCaller(caller(db)).create({
      projectId: PROJECT,
      description: "Værkur 22:30 dansk tid",
      hours: 2,
      // `new Date` tolte dette som 20:30Z den 16/7, altså UTC-dagen. Som
      // dansk tid er det 16/7, så det skal gemmes 16/7.
      date: "2026-07-16T22:30:00",
    });

    expect(storedDate(inserts[0])).toBe("2026-07-16T00:00:00.000Z");
  });

  it("afviser en dag der ikke findes med en 400, ikke en 500", async () => {
    const { db, inserts } = makeDb({ tables: baseTables() });

    // `new Date("2026-02-31")` blev 3. marts, så klienten fik en post på en
    // dag den aldrig bad om.
    await expect(
      timeRouter.createCaller(caller(db)).create({
        projectId: PROJECT,
        description: "Umulig dato",
        hours: 2,
        date: "2026-02-31",
      }),
    ).rejects.toThrow(/Ugyldig dato/);
    expect(inserts).toHaveLength(0);
  });

  it("afviser en dato der ikke er en dato", async () => {
    const { db, inserts } = makeDb({ tables: baseTables() });

    // `new Date("16.07.2026")` er Invalid Date, og drizzle kastede så i
    // `toISOString()` — mutationen svarede 500 med en uforståelig fejl.
    await expect(
      timeRouter.createCaller(caller(db)).create({
        projectId: PROJECT,
        description: "Dansk datoformat",
        hours: 2,
        date: "16.07.2026",
      }),
    ).rejects.toThrow(/Ugyldig dato/);
    expect(inserts).toHaveLength(0);
  });
});

describe("time.bulkImport lægger hver post på sin egen danske dag", () => {
  it("gemmer præcis den dag klienten skrev i CSV'en", async () => {
    const { db, inserts } = makeDb({
      rows: [SAVED_ENTRY],
      tables: baseTables(),
    });

    const result = await timeRouter.createCaller(caller(db)).bulkImport({
      entries: [
        {
          date: "2026-07-15T22:30:00.000Z",
          hours: 2,
          description: "Import fra CSV",
          projectName: "Rådgivning",
        },
      ],
      defaultProjectId: PROJECT,
    });

    expect(result.errors).toEqual([]);
    expect(storedDate(inserts[0])).toBe("2026-07-16T00:00:00.000Z");
  });

  it("raporterer én ugyldig dato og importerer resten af filen", async () => {
    // Importen er pr. række hele vejen igennem, så en ugyldig celle må kun
    // tage den række med sig. Helt opgaven at validere i zod ville afvise
    // hele filen og miste de gyldige registreringer.
    const { db, inserts } = makeDb({
      rows: [SAVED_ENTRY],
      tables: baseTables(),
    });

    const result = await timeRouter.createCaller(caller(db)).bulkImport({
      entries: [
        {
          date: "2026-02-31",
          hours: 1,
          description: "Umulig dato",
          projectName: "Rådgivning",
        },
        {
          date: "2026-07-16",
          hours: 2,
          description: "Gyldig række",
          projectName: "Rådgivning",
        },
      ],
      defaultProjectId: PROJECT,
      skipDuplicates: false,
    });

    expect(result.imported).toBe(1);
    expect(result.errors).toEqual([
      { row: 1, error: 'Ugyldig dato: "2026-02-31"' },
    ]);
    expect(inserts).toHaveLength(1);
    expect(storedDate(inserts[0])).toBe("2026-07-16T00:00:00.000Z");
  });

  it("genkender en tidligere import, også når den ligger på et råt tidspunkt", async () => {
    // Nøglen på de to sider skal være den samme. Den gamle kode brugte
    // `toLocalDateStr` (containerens zone) på den gemte række mod input'ens
    // rå streng. En post som blev skrevet af den gamle kode har et råt
    // tidspunkt i `date` — 22:30Z den 15/7 for en registrering kl. 00:30
    // dansk tid — og `toLocalDateStr` læste den som "2026-07-15" i en
    // container der regner i UTC. Samme CSV-genimport lavede derfor en
    // DUBLET, der faktureres to gange.
    const { db, inserts } = makeDb({
      tables: baseTables({
        timeEntries: [
          {
            // Præcis sådan skrev den gamle kode den her post.
            date: new Date("2026-07-15T22:30:00.000Z"),
            hours: "2",
            description: "Import fra CSV",
            projectId: PROJECT,
          },
        ],
      }),
    });

    const result = await timeRouter.createCaller(caller(db)).bulkImport({
      entries: [
        {
          date: "2026-07-16",
          hours: 2,
          description: "Import fra CSV",
          projectName: "Rådgivning",
        },
      ],
      defaultProjectId: PROJECT,
      skipDuplicates: true,
    });

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
    expect(inserts).toHaveLength(0);
  });

  it("rammer en post der ligger på UTC-midnat", async () => {
    const { db } = makeDb({
      tables: baseTables({
        timeEntries: [
          {
            date: new Date("2026-07-16T00:00:00.000Z"),
            hours: "2",
            description: "Import fra CSV",
            projectId: PROJECT,
          },
        ],
      }),
    });

    const result = await timeRouter.createCaller(caller(db)).bulkImport({
      entries: [
        {
          date: "2026-07-16",
          hours: 2,
          description: "Import fra CSV",
          projectName: "Rådgivning",
        },
      ],
      defaultProjectId: PROJECT,
      skipDuplicates: true,
    });

    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(0);
  });

  /**
   * `hours`-siden af dedupe-nøglen.
   *
   * `time_entries.hours` er `numeric(5, 2)`, og Postgres returnerer værdien som
   * TEKST i kolonnens scale: en gemt 7,5 time læses som `"7.50"`, en gemt 2
   * som `"2.00"`. Input-siden er derimod et zod-tal (`hours: z.number()`), som
   * i en skabelon bliver `"7.5"` hhv. `"2"`. De to nøgler var derfor aldrig
   * ens, så en genimport med "spring dubletter" (default sand både i UI'et og
   * på API'et) oprettede hver post igen — og den duble time blev faktureret to
   * gange.
   *
   * De eksisterende fixtures brugte `hours: "2"`, som ingen databaseværdi har.
   * Derfor var porten grøn oven på en nøgle, der aldrig kunne matche. Her er
   * DB-siden derfor de værdier, Postgres faktisk svarer.
   */
  const timeallFixtures: Array<{ gemt: number; db: string }> = [
    { gemt: 7.5, db: "7.50" },
    { gemt: 2, db: "2.00" },
    { gemt: 0.5, db: "0.50" },
    { gemt: 1.25, db: "1.25" },
  ];

  for (const { gemt, db } of timeallFixtures) {
    it(`springer en dublet over ved ${gemt} time (DB "${db}")`, async () => {
      const { db: mock, inserts } = makeDb({
        tables: baseTables({
          timeEntries: [
            {
              date: new Date("2026-07-16T00:00:00.000Z"),
              hours: db,
              description: "Import fra CSV",
              projectId: PROJECT,
            },
          ],
        }),
      });

      const result = await timeRouter.createCaller(caller(mock)).bulkImport({
        entries: [
          {
            date: "2026-07-16",
            hours: gemt,
            description: "Import fra CSV",
            projectName: "Rådgivning",
          },
        ],
        defaultProjectId: PROJECT,
        skipDuplicates: true,
      });

      expect(result.skipped).toBe(1);
      expect(result.imported).toBe(0);
      expect(inserts).toHaveLength(0);
    });
  }

  it("genkender stadig en reel dublet, når timeallet ER forskelligt", async () => {
    // Modvægten: normaliseringen må ikke slå forskellige timealler sammen,
    // ellers taber importen ægte timer.
    const { db, inserts } = makeDb({
      tables: baseTables({
        timeEntries: [
          {
            date: new Date("2026-07-16T00:00:00.000Z"),
            hours: "7.50",
            description: "Import fra CSV",
            projectId: PROJECT,
          },
        ],
      }),
    });

    const result = await timeRouter.createCaller(caller(db)).bulkImport({
      entries: [
        {
          date: "2026-07-16",
          hours: 7.75,
          description: "Import fra CSV",
          projectName: "Rådgivning",
        },
      ],
      defaultProjectId: PROJECT,
      skipDuplicates: true,
    });

    expect(result.skipped).toBe(0);
    expect(result.imported).toBe(1);
    expect(inserts).toHaveLength(1);
  });
});
