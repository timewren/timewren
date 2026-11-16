import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { router: t.router, protectedProcedure: t.procedure };
});
vi.mock("@/lib/holidays/load", async (original) => ({
  ...(await original<typeof import("@/lib/holidays/load")>()),
  loadDayOffCalendar: vi.fn(),
}));
vi.mock("@/lib/enterprise/flex-calendar", () => ({
  recalculateCalendarFlex: vi.fn(),
}));

import { recalculateCalendarFlex } from "@/lib/enterprise/flex-calendar";
import { DEFAULT_DAY_OFF_CONFIG } from "@/lib/holidays/danish";
import { loadDayOffCalendar } from "@/lib/holidays/load";
import { dayOffRouter } from "../day-off";

const departmentId = "11111111-1111-4111-8111-111111111111";
function setup(
  role: string | null = "admin",
  orgId: string | null = "org",
  enterprise = true,
) {
  const where = vi.fn(async () => undefined);
  const set = vi.fn(() => ({ where }));
  const returning = vi.fn(async () => [{ id: "calendar" }]);
  const values = vi.fn(() => ({ onConflictDoNothing: () => ({ returning }) }));
  const db = {
    query: {
      dayOffCalendars: { findFirst: vi.fn(async (): Promise<unknown> => null) },
      members: { findFirst: vi.fn(async () => (role ? { role } : null)) },
      departments: {
        findFirst: vi.fn(async (): Promise<unknown> => ({ id: departmentId })),
      },
    },
    insert: vi.fn(() => ({ values })),
    update: vi.fn(() => ({ set })),
    delete: vi.fn(() => ({ where })),
    transaction: vi.fn(
      async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    ),
  };
  const caller = dayOffRouter.createCaller({
    db,
    orgId,
    session: { user: { id: "user" } },
    modules: { isEnabled: () => enterprise },
  } as never);
  return { caller, db, values, set, where, returning };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadDayOffCalendar).mockResolvedValue({
    source: "default",
    personalBlockedBy: null,
    config: DEFAULT_DAY_OFF_CONFIG,
    lookup: () => null,
  });
});

describe("dayOff router (#763)", () => {
  it.each(["org", "department", "employee"] as const)(
    "afviser personlig skrivning ved blokering: %s",
    async (personalBlockedBy) => {
      vi.mocked(loadDayOffCalendar).mockResolvedValue({
        source: "org",
        personalBlockedBy,
        config: DEFAULT_DAY_OFF_CONFIG,
        lookup: () => null,
      });
      const { caller, db } = setup();
      await expect(
        caller.saveCalendar({ scope: "user", ...DEFAULT_DAY_OFF_CONFIG }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(db.insert).not.toHaveBeenCalled();
      expect((await caller.getCalendar({ scope: "user" })).canEdit).toBe(false);
      await expect(caller.resetCalendar({ scope: "user" })).resolves.toEqual({
        success: true,
      });
      expect(db.delete).toHaveBeenCalledOnce();
    },
  );
  it.each(["org", "department"] as const)(
    "medlem må læse men ikke skrive eller nulstille %s",
    async (scope) => {
      const { caller, db } = setup("member");
      const input = scope === "org" ? { scope } : { scope, departmentId };
      expect((await caller.getCalendar(input)).canEdit).toBe(false);
      await expect(
        caller.saveCalendar({ ...input, ...DEFAULT_DAY_OFF_CONFIG }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.resetCalendar(input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.delete).not.toHaveBeenCalled();
    },
  );
  it("afviser org uden medlemskab og org-scope uden organisation", async () => {
    await expect(
      setup(null).caller.getCalendar({ scope: "org" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      setup("admin", null).caller.getCalendar({ scope: "org" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("afviser afdeling uden Virksomhed eller med ukendt afdeling", async () => {
    await expect(
      setup("admin", "org", false).caller.getCalendar({
        scope: "department",
        departmentId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { caller, db } = setup();
    db.query.departments.findFirst.mockResolvedValue(null);
    await expect(
      caller.getCalendar({ scope: "department", departmentId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("sorterer egne datoer og afviser dubletter og ugyldige datoer", async () => {
    const { caller, values } = setup("admin", null);
    const customDays = ["2026-12-24", "2026-11-03"].map((date) => ({
      date,
      name: "Fri",
      isHalfDay: false,
    }));
    await caller.saveCalendar({
      scope: "user",
      ...DEFAULT_DAY_OFF_CONFIG,
      customDays,
    });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user",
        organizationId: null,
        customDays: [...customDays].reverse(),
      }),
    );
    for (const days of [
      [customDays[0], customDays[0]],
      [{ ...customDays[0], date: "2026-02-30" }],
    ]) {
      await expect(
        caller.saveCalendar({
          scope: "user",
          ...DEFAULT_DAY_OFF_CONFIG,
          customDays: days,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
  it("genberegner flex ved gem og nulstilling af afdelingens kalender i samme transaktion", async () => {
    const { caller, db } = setup();
    await caller.saveCalendar({
      scope: "department",
      departmentId,
      ...DEFAULT_DAY_OFF_CONFIG,
    });
    expect(recalculateCalendarFlex).toHaveBeenLastCalledWith(db, {
      orgId: "org",
      departmentId,
    });
    await caller.resetCalendar({ scope: "department", departmentId });
    expect(recalculateCalendarFlex).toHaveBeenCalledTimes(2);
    expect(db.transaction).toHaveBeenCalledTimes(2);
  });
});

it("opdaterer en eksisterende kalender og genberegner organisationens flex", async () => {
  const { caller, db, set } = setup("owner");
  db.query.dayOffCalendars.findFirst.mockResolvedValue({ id: "existing" });
  await caller.saveCalendar({ scope: "org", ...DEFAULT_DAY_OFF_CONFIG });
  expect(db.insert).not.toHaveBeenCalled();
  expect(set).toHaveBeenCalledWith(
    expect.objectContaining({ preset: "private" }),
  );
  expect(recalculateCalendarFlex).toHaveBeenLastCalledWith(db, {
    orgId: "org",
  });
});

it("håndterer samtidig første oprettelse uden at afbryde transaktionen", async () => {
  const { caller, set, returning } = setup();
  returning.mockResolvedValue([]);
  await expect(
    caller.saveCalendar({ scope: "org", ...DEFAULT_DAY_OFF_CONFIG }),
  ).resolves.toEqual({ success: true });
  expect(set).toHaveBeenCalledOnce();
});

it("lader fejl i flexgenberegning afbryde gem og nulstilling", async () => {
  const { caller } = setup();
  vi.mocked(recalculateCalendarFlex).mockRejectedValueOnce(
    new Error("recalc failed"),
  );
  await expect(
    caller.saveCalendar({ scope: "org", ...DEFAULT_DAY_OFF_CONFIG }),
  ).rejects.toThrow("recalc failed");
  vi.mocked(recalculateCalendarFlex).mockRejectedValueOnce(
    new Error("reset failed"),
  );
  await expect(caller.resetCalendar({ scope: "org" })).rejects.toThrow(
    "reset failed",
  );
});
