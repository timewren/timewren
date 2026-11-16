import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCALES } from "@/i18n/config";
import { mailT } from "@/lib/email/locale";
import { buildDigest } from "../bus/digest";
import {
  NOTIFICATION_EVENTS,
  type NotificationPayloads,
  renderNotification,
} from "../bus/events";

// Eksempeldata pr. hændelse. Alle fire sprog renderes uden manglende nøgler.
const payloads: { [E in keyof NotificationPayloads]: NotificationPayloads[E] } =
  {
    "timesheet.submitted": {
      employeeName: "Anna",
      employeeUserId: "u1",
      weekStart: "2026-10-05",
      totalHours: 37.5,
    },
    "timesheet.approved": { managerName: "Leif", weekStart: "2026-10-05" },
    "timesheet.rejected": {
      managerName: "Leif",
      weekStart: "2026-10-05",
      rejectionReason: "Mangler timer",
    },
    "timesheet.reopened": {
      managerName: "Leif",
      weekStart: "2026-10-05",
      reason: "Ret",
    },
    "period.closing_ready": { periodLabel: "oktober 2026", count: 3 },
    "period.closing_approved": { managerName: "Leif", periodLabel: "oktober" },
    "period.closing_unlocked": {
      actorName: "Leif",
      periodLabel: "oktober",
      reason: "Fejl",
    },
    "absence.requested": {
      employeeName: "Anna",
      employeeUserId: "u1",
      typeName: "Ferie",
      startDate: "2026-10-12",
      endDate: "2026-10-16",
      totalDays: 5,
    },
    "absence.approved": {
      managerName: "Leif",
      typeName: "Ferie",
      startDate: "2026-10-12",
      endDate: null,
    },
    "absence.rejected": {
      managerName: "Leif",
      typeName: "Ferie",
      startDate: "2026-10-12",
      endDate: "2026-10-12",
      rejectionReason: "Travlt",
    },
    "absence.registered": {
      registrarName: "Leif",
      typeName: "Ferie",
      startDate: "2026-10-12",
      endDate: "2026-10-16",
    },
    "absence.sick_registered": {
      employeeName: "Anna",
      employeeUserId: "u1",
      typeName: "Sygdom",
      startDate: "2026-10-12",
      endDate: null,
    },
    "reminder.timesheet_missing": {
      weekStart: "2026-10-05",
      registeredHours: 12,
    },
    "reminder.coverage_low": {
      date: "2026-10-12",
      loggedHours: 3,
      expectedHours: 7.4,
      coveragePct: 40.5,
      threshold: 80,
    },
    "compliance.warning": {
      employeeName: "Anna",
      employeeUserId: "u1",
      weekStart: "2026-10-05",
      findings: ["11 timers hvile"],
    },
    "compliance.forecast": {
      employeeName: "Anna",
      weekStart: "2026-11-09",
      findings: ["10 timers hvile"],
    },
    "digest.manager": {
      period: "weekly",
      missingTimesheets: [{ employeeName: "Anna", detail: "mangler" }],
      pendingTimesheets: [
        { employeeName: "Bo", detail: "afventer", ageDays: 3 },
      ],
      pendingAbsence: [],
      escalated: true,
    },
  };

const RAW_KEY = /\b(?:ev|digestItem|push|discord|slack|admin|msg)\.[a-z]\w*/;

describe("notifikationstekster på alle sprog", () => {
  afterEach(() => vi.restoreAllMocks());

  for (const event of NOTIFICATION_EVENTS) {
    for (const locale of LOCALES) {
      it(`${event} (${locale}) har titel og tekst uden manglende nøgler`, () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => {});
        const r = renderNotification(event, payloads[event] as never, locale);
        expect(errors).not.toHaveBeenCalled();
        expect(r.title.length).toBeGreaterThan(0);
        expect(r.body.length).toBeGreaterThan(0);
        expect(`${r.title} ${r.body}`).not.toMatch(RAW_KEY);
      });
    }
  }

  it("sproget følger modtageren", () => {
    const da = renderNotification(
      "timesheet.approved",
      payloads["timesheet.approved"],
    );
    const de = renderNotification(
      "timesheet.approved",
      payloads["timesheet.approved"],
      "de",
    );
    expect(da.title).toBe("Timeseddel godkendt");
    expect(de.title).toBe("Stundenzettel freigegeben");
  });

  it("leder-digesten bygges på lederens sprog", () => {
    const base = {
      source: {
        employees: [{ userId: "a", name: "Anna" }],
        lastWeekStart: "2026-10-05",
        handledLastWeek: new Set<string>(),
        pendingTimesheets: [],
        pendingAbsence: [],
        today: new Date("2026-10-13T08:00:00Z"),
      },
      scopeUserIds: null,
      period: "weekly" as const,
      escalationDays: null,
    };
    expect(buildDigest(base).missingTimesheets[0].detail).toContain(
      "ikke indsendt",
    );
    expect(
      buildDigest({ ...base, locale: "en" }).missingTimesheets[0].detail,
    ).toContain("not submitted");
  });

  it("push- og beskedtekster findes på alle sprog", () => {
    for (const locale of LOCALES) {
      const t = mailT("notifications", locale);
      expect(t("push.deadlineTitle")).not.toMatch(RAW_KEY);
      expect(t("msg.idleDetected.message", { minutes: 5 })).toContain("5");
      expect(t("push.digestTasks", { count: 2 })).toContain("2");
    }
  });
});
