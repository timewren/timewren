import { describe, expect, it, vi } from "vitest";

// Moduler der ellers åbner en databaseforbindelse ved import
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email/engagement", () => ({
  sendFirstTimeEntryEmail: vi.fn(),
}));
vi.mock("@/lib/email/prepaid", () => ({ sendLowBalanceAlert: vi.fn() }));

import {
  getRateForTimeEntry,
  getRateFromCache,
  type RateLookupCache,
} from "@/lib/trpc/routers/time";
import { planRestamp, type RestampCandidate } from "./restamp";
import {
  indexScheduledChanges,
  type ScheduledRateChangeLite,
} from "./scheduled";
import {
  type ApplyRateChangeStore,
  applyDueRateChanges,
  type DueRateChange,
} from "./scheduled-service";

const USER = "user-1";
const KUNDE_A = "11111111-1111-1111-1111-111111111111";
const OTHER_CLIENT = "33333333-3333-3333-3333-333333333333";
const PROJECT = "22222222-2222-2222-2222-222222222222";

let seq = 0;
function change(
  overrides: Partial<ScheduledRateChangeLite> = {},
): ScheduledRateChangeLite {
  seq++;
  return {
    id: `change-${seq}`,
    clientId: KUNDE_A,
    projectId: null,
    newRate: "800.00",
    oldRate: null,
    effectiveDate: "2026-11-01",
    appliedAt: null,
    cancelledAt: null,
    createdAt: new Date(Date.UTC(2026, 8, 1, 10, 0, seq)),
    ...overrides,
  };
}

function cache(
  changes: ScheduledRateChangeLite[],
  overrides: Partial<RateLookupCache> = {},
): RateLookupCache {
  return {
    projects: new Map([[PROJECT, { hourlyRate: null, clientId: KUNDE_A }]]),
    clients: new Map([
      [KUNDE_A, "600.00"],
      [OTHER_CLIENT, "500.00"],
    ]),
    userDefaultRate: "400.00",
    memberRates: [],
    scheduled: indexScheduledChanges(changes),
    ...overrides,
  };
}

// =============================================
// getRateFromCache — dato-bevidst hierarki
// =============================================
describe("getRateFromCache med planlagte satsændringer", () => {
  it("stempler direkte klient-tid efter postens dato, ikke oprettelsestidspunktet", () => {
    const c = cache([change()]);
    expect(getRateFromCache(c, null, KUNDE_A, "2026-10-31")).toBe("600.00");
    expect(getRateFromCache(c, null, KUNDE_A, "2026-11-01")).toBe("800.00");
    expect(
      getRateFromCache(c, null, KUNDE_A, new Date("2026-11-01T00:00:00Z")),
    ).toBe("800.00");
  });

  it("gælder også projekter uden egen sats der arver klientens", () => {
    const c = cache([change()]);
    expect(getRateFromCache(c, PROJECT, null, "2026-10-31")).toBe("600.00");
    expect(getRateFromCache(c, PROJECT, null, "2026-11-01")).toBe("800.00");
  });

  it("lader projektsatsen slå klientens planlagte ændring", () => {
    const c = cache([change()], {
      projects: new Map([
        [PROJECT, { hourlyRate: "950.00", clientId: KUNDE_A }],
      ]),
    });
    expect(getRateFromCache(c, PROJECT, KUNDE_A, "2026-11-15")).toBe("950.00");
  });

  it("bruger en planlagt projektændring frem for klientens", () => {
    const c = cache(
      [
        change(),
        change({ clientId: null, projectId: PROJECT, newRate: "1000.00" }),
      ],
      {
        projects: new Map([
          [PROJECT, { hourlyRate: "900.00", clientId: KUNDE_A }],
        ]),
      },
    );
    expect(getRateFromCache(c, PROJECT, KUNDE_A, "2026-10-31")).toBe("900.00");
    expect(getRateFromCache(c, PROJECT, KUNDE_A, "2026-11-01")).toBe("1000.00");
  });

  it("falder tilbage til klienten før en anvendt første projektsats", () => {
    const c = cache(
      [
        change({
          clientId: null,
          projectId: PROJECT,
          newRate: "1000.00",
          oldRate: null,
          appliedAt: new Date(Date.UTC(2026, 9, 31, 23, 5)),
        }),
      ],
      {
        projects: new Map([
          [PROJECT, { hourlyRate: "1000.00", clientId: KUNDE_A }],
        ]),
      },
    );
    expect(getRateFromCache(c, PROJECT, null, "2026-10-15")).toBe("600.00");
    expect(getRateFromCache(c, PROJECT, null, "2026-11-15")).toBe("1000.00");
  });

  it("lader medlemssatser være uændrede", () => {
    const c = cache([change()], {
      memberRates: [
        { projectId: null, clientId: KUNDE_A, hourlyRate: "650.00" },
      ],
    });
    expect(getRateFromCache(c, null, KUNDE_A, "2026-11-15")).toBe("650.00");
  });

  it("ignorerer annullerede ændringer", () => {
    const c = cache([change({ cancelledAt: new Date() })]);
    expect(getRateFromCache(c, null, KUNDE_A, "2026-11-15")).toBe("600.00");
  });

  it("påvirker ikke andre klienter", () => {
    const c = cache([change()]);
    expect(getRateFromCache(c, null, OTHER_CLIENT, "2026-11-15")).toBe(
      "500.00",
    );
  });

  it("opfører sig som før uden dato", () => {
    const c = cache([change()]);
    expect(getRateFromCache(c, null, KUNDE_A)).toBe("600.00");
  });
});

// =============================================
// getRateForTimeEntry — DB-opslag med dato
// =============================================
describe("getRateForTimeEntry med dato", () => {
  type MockDb = Parameters<typeof getRateForTimeEntry>[0];

  function createMockDb(changes: ScheduledRateChangeLite[]) {
    return {
      query: {
        projects: { findFirst: vi.fn() },
        clients: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: KUNDE_A, defaultHourlyRate: "600.00" }),
        },
        users: {
          findFirst: vi.fn().mockResolvedValue({ defaultHourlyRate: "400.00" }),
        },
        scheduledRateChanges: {
          findMany: vi.fn().mockResolvedValue(changes),
        },
      },
    };
  }

  it("slår ændringerne op i én query og bruger postens dato", async () => {
    const db = createMockDb([change()]);
    const before = await getRateForTimeEntry(
      db as unknown as MockDb,
      USER,
      null,
      KUNDE_A,
      null,
      "2026-10-31",
    );
    const after = await getRateForTimeEntry(
      db as unknown as MockDb,
      USER,
      null,
      KUNDE_A,
      null,
      "2026-11-01",
    );
    expect(before).toBe("600.00");
    expect(after).toBe("800.00");
    expect(db.query.scheduledRateChanges.findMany).toHaveBeenCalledTimes(2);
  });

  it("henter ikke ændringer når der ingen dato er", async () => {
    const db = createMockDb([change()]);
    const rate = await getRateForTimeEntry(
      db as unknown as MockDb,
      USER,
      null,
      KUNDE_A,
    );
    expect(rate).toBe("600.00");
    expect(db.query.scheduledRateChanges.findMany).not.toHaveBeenCalled();
  });

  it("bruger den gamle sats for tid registreret bagud efter skiftet er anvendt", async () => {
    const db = createMockDb([
      change({
        oldRate: "600.00",
        appliedAt: new Date(Date.UTC(2026, 9, 31, 23, 5)),
      }),
    ]);
    db.query.clients.findFirst.mockResolvedValue({
      id: KUNDE_A,
      defaultHourlyRate: "800.00",
    });
    const rate = await getRateForTimeEntry(
      db as unknown as MockDb,
      USER,
      null,
      KUNDE_A,
      null,
      "2026-10-20",
    );
    expect(rate).toBe("600.00");
  });
});

// =============================================
// planRestamp — genstempling ved oprettelse/annullering
// =============================================
describe("planRestamp", () => {
  const entries: RestampCandidate[] = [
    {
      id: "before",
      projectId: null,
      clientId: KUNDE_A,
      date: new Date("2026-10-31T00:00:00Z"),
      billableRate: "600.00",
    },
    {
      id: "on-date",
      projectId: null,
      clientId: KUNDE_A,
      date: new Date("2026-11-01T00:00:00Z"),
      billableRate: "600.00",
    },
    {
      id: "manual-override",
      projectId: null,
      clientId: KUNDE_A,
      date: new Date("2026-11-05T00:00:00Z"),
      billableRate: "1200.00",
    },
    {
      id: "project-own-rate",
      projectId: PROJECT,
      clientId: KUNDE_A,
      date: new Date("2026-11-05T00:00:00Z"),
      billableRate: "950.00",
    },
  ];

  it("genstempler kun poster fra datoen der havde hierarkiets sats", () => {
    const planned = change();
    const plan = planRestamp(
      entries,
      cache([], {
        projects: new Map([
          [PROJECT, { hourlyRate: "950.00", clientId: KUNDE_A }],
        ]),
      }),
      cache([planned], {
        projects: new Map([
          [PROJECT, { hourlyRate: "950.00", clientId: KUNDE_A }],
        ]),
      }),
      planned.effectiveDate,
    );
    expect(plan.get("800.00")).toEqual(["on-date"]);
    expect([...plan.values()].flat()).toHaveLength(1);
  });

  it("ruller tilbage ved annullering", () => {
    const planned = change();
    const plan = planRestamp(
      [{ ...entries[1], billableRate: "800.00" }],
      cache([planned]),
      cache([]),
      planned.effectiveDate,
    );
    expect(plan.get("600.00")).toEqual(["on-date"]);
  });
});

// =============================================
// applyDueRateChanges — cron-anvendelse
// =============================================
describe("applyDueRateChanges", () => {
  function createStore(initial: DueRateChange[], rates: Map<string, string>) {
    const changes = initial.map((c) => ({
      ...c,
      oldRate: null as string | null,
    }));
    const history: {
      oldRate: string | null;
      newRate: string;
      effectiveDate: string;
    }[] = [];
    const store: ApplyRateChangeStore = {
      async listDue(today) {
        return changes.filter(
          (c) => !c.appliedAt && !c.cancelledAt && c.effectiveDate <= today,
        );
      },
      async apply(c, appliedAt) {
        const row = changes.find((r) => r.id === c.id);
        if (!row || row.appliedAt || row.cancelledAt) return false;
        const key = (row.projectId ?? row.clientId) as string;
        row.appliedAt = appliedAt;
        row.oldRate = rates.get(key) ?? null;
        rates.set(key, row.newRate);
        history.push({
          oldRate: row.oldRate,
          newRate: row.newRate,
          effectiveDate: row.effectiveDate,
        });
        return true;
      },
    };
    return { store, changes, history, rates };
  }

  function due(overrides: Partial<DueRateChange> = {}): DueRateChange {
    seq++;
    return {
      id: `due-${seq}`,
      userId: USER,
      organizationId: null,
      clientId: KUNDE_A,
      projectId: null,
      newRate: "800.00",
      effectiveDate: "2026-11-01",
      appliedAt: null,
      cancelledAt: null,
      createdAt: new Date(Date.UTC(2026, 8, 1, 10, 0, seq)),
      ...overrides,
    };
  }

  it("anvender en forfalden ændring og gemmer den gamle sats", async () => {
    const { store, changes, history, rates } = createStore(
      [due()],
      new Map([[KUNDE_A, "600.00"]]),
    );
    const result = await applyDueRateChanges(store, "2026-11-01");
    expect(result).toMatchObject({ due: 1, applied: 1, failed: 0 });
    expect(rates.get(KUNDE_A)).toBe("800.00");
    expect(changes[0].oldRate).toBe("600.00");
    expect(history).toEqual([
      { oldRate: "600.00", newRate: "800.00", effectiveDate: "2026-11-01" },
    ]);
  });

  it("er idempotent — en ny kørsel samme dag gør intet", async () => {
    const { store, history, rates } = createStore(
      [due()],
      new Map([[KUNDE_A, "600.00"]]),
    );
    await applyDueRateChanges(store, "2026-11-01");
    const second = await applyDueRateChanges(store, "2026-11-01");
    expect(second).toMatchObject({ due: 0, applied: 0 });
    expect(history).toHaveLength(1);
    expect(rates.get(KUNDE_A)).toBe("800.00");
  });

  it("springer over hvis en samtidig kørsel nåede først", async () => {
    const change1 = due();
    const store: ApplyRateChangeStore = {
      listDue: async () => [change1],
      apply: async () => false,
    };
    const result = await applyDueRateChanges(store, "2026-11-01");
    expect(result).toMatchObject({ due: 1, applied: 0, skipped: 1 });
  });

  it("anvender ikke fremtidige eller annullerede ændringer", async () => {
    const { store, rates } = createStore(
      [
        due({ effectiveDate: "2026-11-02" }),
        due({ cancelledAt: new Date(), newRate: "999.00" }),
      ],
      new Map([[KUNDE_A, "600.00"]]),
    );
    const result = await applyDueRateChanges(store, "2026-11-01");
    expect(result.applied).toBe(0);
    expect(rates.get(KUNDE_A)).toBe("600.00");
  });

  it("anvender flere ændringer i kø i datoorden, så oldRate kædes korrekt", async () => {
    const { store, changes, rates } = createStore(
      // Bevidst i omvendt rækkefølge
      [
        due({ effectiveDate: "2027-01-01", newRate: "900.00" }),
        due({ effectiveDate: "2026-11-01", newRate: "800.00" }),
      ],
      new Map([[KUNDE_A, "600.00"]]),
    );
    const result = await applyDueRateChanges(store, "2027-01-01");
    expect(result.applied).toBe(2);
    expect(rates.get(KUNDE_A)).toBe("900.00");
    const byDate = Object.fromEntries(
      changes.map((c) => [c.effectiveDate, c.oldRate]),
    );
    expect(byDate).toEqual({ "2026-11-01": "600.00", "2027-01-01": "800.00" });
  });

  it("anvender ikke en senere ændring for samme klient når en tidligere fejler", async () => {
    const early = due({ effectiveDate: "2026-11-01" });
    const late = due({ effectiveDate: "2026-12-01", newRate: "900.00" });
    const applied: string[] = [];
    const store: ApplyRateChangeStore = {
      listDue: async () => [late, early],
      apply: async (c) => {
        if (c.id === early.id) throw new Error("midlertidig fejl");
        applied.push(c.id);
        return true;
      },
    };
    const result = await applyDueRateChanges(store, "2026-12-01");
    expect(applied).toEqual([]);
    expect(result).toMatchObject({ applied: 0, failed: 1, skipped: 1 });
  });

  it("fortsætter med resten når én ændring fejler", async () => {
    const ok = due({ clientId: OTHER_CLIENT });
    const broken = due();
    const store: ApplyRateChangeStore = {
      listDue: async () => [broken, ok],
      apply: async (c) => {
        if (c.id === broken.id) throw new Error("Klienten findes ikke længere");
        return true;
      },
    };
    const result = await applyDueRateChanges(store, "2026-11-01");
    expect(result).toMatchObject({ applied: 1, failed: 1 });
    expect(result.errors[0]).toEqual({
      id: broken.id,
      message: "Klienten findes ikke længere",
    });
  });
});
