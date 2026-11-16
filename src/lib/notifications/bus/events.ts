/**
 * Hændelseskatalog for notifikationsbussen (E10, #468).
 *
 * Hver hændelse har en gruppe (styrer præferencer), et publikum (employee =
 * modtageren er den det handler om; manager = leder/admin — kun disse går
 * til org-kanalen Teams) og en ren render-funktion der giver titel, tekst og
 * link til de generiske kanaler (in-app, push, Teams). E-mail-kanalen bruger
 * de eksisterende skabeloner hvor de findes.
 */

import { toIntlLocale } from "@/i18n/format-locale";
import { formatMailPeriod, mailT } from "@/lib/email/locale";

export const NOTIFICATION_CHANNELS = [
  "in_app",
  "email",
  "push",
  "teams",
] as const;
export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_GROUPS = [
  "timesheet",
  "absence",
  "reminder",
  "compliance",
  "digest",
] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

/**
 * Danske standardtekster til indstillingssiderne. De samme tekster ligger i
 * `notifications`-kataloget (groups.*, channels.*) til oversatte skærme.
 */
export const NOTIFICATION_GROUP_LABELS: Record<NotificationGroup, string> = {
  timesheet: "Timesedler",
  absence: "Ferie og fravær",
  reminder: "Påmindelser",
  compliance: "Arbejdstidsregler",
  digest: "Leder-digest",
};

export const NOTIFICATION_GROUP_DESCRIPTIONS: Record<
  NotificationGroup,
  string
> = {
  timesheet:
    "Indsendt, godkendt, afvist og genåbnet — og periodeafslutning (opgørelse, godkendelse, kvittering)",
  absence: "Anmodninger, afgørelser, registreringer og sygemeldinger",
  reminder:
    "Fredags-påmindelse når timesedlen mangler, og (valgfrit) når gårsdagens dækningsgrad er lav",
  compliance:
    "Advarsler om arbejdstidsregler ved indsendelse og for arbejdsplaner",
  digest: "Dagligt/ugentligt overblik til ledere",
};

export const NOTIFICATION_CHANNEL_LABELS: Record<
  NotificationChannelKey,
  string
> = {
  in_app: "I appen",
  email: "E-mail",
  push: "Push",
  teams: "Microsoft Teams",
};

export interface DigestItem {
  employeeName: string;
  detail: string;
  /** Alder i dage — bruges til eskalering */
  ageDays?: number;
}

export interface NotificationPayloads {
  "timesheet.submitted": {
    employeeName: string;
    employeeUserId: string;
    weekStart: string;
    totalHours: number;
  };
  "timesheet.approved": { managerName: string; weekStart: string };
  "timesheet.rejected": {
    managerName: string;
    weekStart: string;
    rejectionReason?: string | null;
  };
  "timesheet.reopened": {
    managerName: string;
    weekStart: string;
    reason?: string | null;
  };
  // Periodeafslutning (#518)
  "period.closing_ready": {
    periodLabel: string;
    /** Antal opgørelser der afventer modtagerens godkendelse */
    count: number;
  };
  "period.closing_approved": { managerName: string; periodLabel: string };
  "period.closing_unlocked": {
    actorName: string;
    periodLabel: string;
    reason: string;
  };
  "absence.requested": {
    employeeName: string;
    employeeUserId: string;
    typeName: string;
    startDate: string;
    endDate: string | null;
    totalDays: number | null;
    note?: string | null;
  };
  "absence.approved": {
    managerName: string;
    typeName: string;
    startDate: string;
    endDate: string | null;
  };
  "absence.rejected": {
    managerName: string;
    typeName: string;
    startDate: string;
    endDate: string | null;
    rejectionReason?: string | null;
  };
  "absence.registered": {
    registrarName: string;
    typeName: string;
    startDate: string;
    endDate: string | null;
    hoursPerDay?: number | null;
  };
  "absence.sick_registered": {
    employeeName: string;
    employeeUserId: string;
    typeName: string;
    startDate: string;
    endDate: string | null;
  };
  "reminder.timesheet_missing": { weekStart: string; registeredHours: number };
  // Dækningsgrad (#679): gårsdagens loggede tid under brugerens tærskel
  "reminder.coverage_low": {
    date: string;
    loggedHours: number;
    expectedHours: number;
    coveragePct: number;
    threshold: number;
  };
  "compliance.warning": {
    employeeName: string;
    employeeUserId: string;
    weekStart: string;
    findings: string[];
  };
  "compliance.forecast": {
    weekStart: string;
    findings: string[];
    employeeName?: string;
  };
  "digest.manager": {
    period: "daily" | "weekly";
    missingTimesheets: DigestItem[];
    pendingTimesheets: DigestItem[];
    pendingAbsence: DigestItem[];
    escalated: boolean;
  };
}

export type NotificationEvent = keyof NotificationPayloads;

export const NOTIFICATION_EVENTS = [
  "timesheet.submitted",
  "timesheet.approved",
  "timesheet.rejected",
  "timesheet.reopened",
  "period.closing_ready",
  "period.closing_approved",
  "period.closing_unlocked",
  "absence.requested",
  "absence.approved",
  "absence.rejected",
  "absence.registered",
  "absence.sick_registered",
  "reminder.timesheet_missing",
  "reminder.coverage_low",
  "compliance.warning",
  "compliance.forecast",
  "digest.manager",
] as const satisfies readonly NotificationEvent[];

export type NotificationAudience = "employee" | "manager";

export interface RenderedNotification {
  title: string;
  body: string;
  url: string;
  /** Ekstra linjer til Teams-kortet (facts) */
  facts?: Array<{ name: string; value: string }>;
}

interface EventDefinition<E extends NotificationEvent> {
  group: NotificationGroup;
  audience: NotificationAudience;
  render: (
    payload: NotificationPayloads[E],
    locale: string,
  ) => RenderedNotification;
}

const TIMESHEET_URL = "/dashboard/enterprise/timesheet";
const TEAM_URL = "/dashboard/enterprise/team";
const ABSENCE_URL = "/dashboard/enterprise/absence";
const COVERAGE_URL = "/dashboard/reports/coverage";
const PERIOD_CLOSING_URL = "/dashboard/enterprise/period-closing";

function formatDayLabel(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(
    toIntlLocale(locale),
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    },
  );
}

export function formatWeekLabel(weekStart: string, locale = "da"): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNo =
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    );
  return mailT("notifications", locale)("weekLabel", { week: weekNo });
}

function formatHours(hours: number, locale: string): string {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(hours);
}

function formatPct(pct: number): string {
  return `${Math.round(pct)} %`;
}

function digestLines(
  label: string,
  items: DigestItem[],
  locale: string,
): string[] {
  if (items.length === 0) return [];
  const t = mailT("notifications", locale);
  return [
    t("ev.digestSection", { label, count: items.length }),
    ...items
      .slice(0, 10)
      .map(
        (i) =>
          `• ${i.employeeName} — ${i.detail}${i.ageDays != null && i.ageDays > 0 ? ` ${t("ev.digestAge", { days: i.ageDays })}` : ""}`,
      ),
    ...(items.length > 10
      ? [t("ev.digestMore", { count: items.length - 10 })]
      : []),
  ];
}

export const EVENT_DEFINITIONS: {
  [E in NotificationEvent]: EventDefinition<E>;
} = {
  "timesheet.submitted": {
    group: "timesheet",
    audience: "manager",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      const week = formatWeekLabel(p.weekStart, locale);
      const hours = formatHours(p.totalHours, locale);
      return {
        title: t("ev.timesheetSubmitted.title"),
        body: t("ev.timesheetSubmitted.body", {
          employee: p.employeeName,
          week,
          hours,
        }),
        url: TEAM_URL,
        facts: [
          { name: t("ev.factEmployee"), value: p.employeeName },
          { name: t("ev.factWeek"), value: week },
          { name: t("ev.factHours"), value: hours },
        ],
      };
    },
  },
  "timesheet.approved": {
    group: "timesheet",
    audience: "employee",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      return {
        title: t("ev.timesheetApproved.title"),
        body: t("ev.timesheetApproved.body", {
          manager: p.managerName,
          week: formatWeekLabel(p.weekStart, locale),
        }),
        url: TIMESHEET_URL,
      };
    },
  },
  "timesheet.rejected": {
    group: "timesheet",
    audience: "employee",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      const values = {
        manager: p.managerName,
        week: formatWeekLabel(p.weekStart, locale),
        reason: p.rejectionReason ?? "",
      };
      return {
        title: t("ev.timesheetRejected.title"),
        body: p.rejectionReason
          ? t("ev.timesheetRejected.bodyReason", values)
          : t("ev.timesheetRejected.body", values),
        url: TIMESHEET_URL,
      };
    },
  },
  "timesheet.reopened": {
    group: "timesheet",
    audience: "employee",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      const values = {
        manager: p.managerName,
        week: formatWeekLabel(p.weekStart, locale),
        reason: p.reason ?? "",
      };
      return {
        title: t("ev.timesheetReopened.title"),
        body: p.reason
          ? t("ev.timesheetReopened.bodyReason", values)
          : t("ev.timesheetReopened.body", values),
        url: TIMESHEET_URL,
      };
    },
  },
  "period.closing_ready": {
    group: "timesheet",
    audience: "manager",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      return {
        title: t("ev.closingReady.title"),
        body: t("ev.closingReady.body", {
          count: p.count,
          period: p.periodLabel,
        }),
        url: PERIOD_CLOSING_URL,
        facts: [
          { name: t("ev.factPeriod"), value: p.periodLabel },
          { name: t("ev.factStatements"), value: String(p.count) },
        ],
      };
    },
  },
  "period.closing_approved": {
    group: "timesheet",
    audience: "employee",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      return {
        title: t("ev.closingApproved.title"),
        body: t("ev.closingApproved.body", {
          manager: p.managerName,
          period: p.periodLabel,
        }),
        url: PERIOD_CLOSING_URL,
      };
    },
  },
  "period.closing_unlocked": {
    group: "timesheet",
    audience: "employee",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      return {
        title: t("ev.closingUnlocked.title"),
        body: t("ev.closingUnlocked.body", {
          actor: p.actorName,
          period: p.periodLabel,
          reason: p.reason,
        }),
        url: PERIOD_CLOSING_URL,
      };
    },
  },
  "absence.requested": {
    group: "absence",
    audience: "manager",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      const period = formatMailPeriod(p.startDate, p.endDate, locale);
      return {
        title: t("ev.absenceRequested.title"),
        // Medarbejderens note (kan rumme helbredsoplysninger) udelades bevidst
        // her — den går kun med i e-mailen til lederen, ikke til Teams/push/in-app.
        body: t("ev.absenceRequested.body", {
          employee: p.employeeName,
          type: p.typeName.toLowerCase(),
          period,
        }),
        url: ABSENCE_URL,
        facts: [
          { name: t("ev.factEmployee"), value: p.employeeName },
          { name: t("ev.factType"), value: p.typeName },
          { name: t("ev.factPeriod"), value: period },
        ],
      };
    },
  },
  "absence.approved": {
    group: "absence",
    audience: "employee",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      return {
        title: t("ev.absenceApproved.title"),
        body: t("ev.absenceApproved.body", {
          manager: p.managerName,
          type: p.typeName.toLowerCase(),
          period: formatMailPeriod(p.startDate, p.endDate, locale),
        }),
        url: ABSENCE_URL,
      };
    },
  },
  "absence.rejected": {
    group: "absence",
    audience: "employee",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      const values = {
        manager: p.managerName,
        type: p.typeName.toLowerCase(),
        period: formatMailPeriod(p.startDate, p.endDate, locale),
        reason: p.rejectionReason ?? "",
      };
      return {
        title: t("ev.absenceRejected.title"),
        body: p.rejectionReason
          ? t("ev.absenceRejected.bodyReason", values)
          : t("ev.absenceRejected.body", values),
        url: ABSENCE_URL,
      };
    },
  },
  "absence.registered": {
    group: "absence",
    audience: "employee",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      return {
        title: t("ev.absenceRegistered.title"),
        body: t("ev.absenceRegistered.body", {
          registrar: p.registrarName,
          type: p.typeName.toLowerCase(),
          period: formatMailPeriod(p.startDate, p.endDate, locale),
        }),
        url: ABSENCE_URL,
      };
    },
  },
  "absence.sick_registered": {
    group: "absence",
    audience: "manager",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      const period = formatMailPeriod(p.startDate, p.endDate, locale);
      return {
        title: t("ev.sickRegistered.title"),
        body: t("ev.sickRegistered.body", { employee: p.employeeName, period }),
        url: ABSENCE_URL,
        facts: [
          { name: t("ev.factEmployee"), value: p.employeeName },
          { name: t("ev.factType"), value: p.typeName },
          { name: t("ev.factPeriod"), value: period },
        ],
      };
    },
  },
  "reminder.timesheet_missing": {
    group: "reminder",
    audience: "employee",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      const week = formatWeekLabel(p.weekStart, locale);
      return {
        title: t("ev.timesheetMissing.title"),
        body:
          p.registeredHours > 0
            ? t("ev.timesheetMissing.bodyHours", {
                hours: formatHours(p.registeredHours, locale),
                week,
              })
            : t("ev.timesheetMissing.bodyNone", { week }),
        url: TIMESHEET_URL,
      };
    },
  },
  "reminder.coverage_low": {
    group: "reminder",
    audience: "employee",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      const logged = formatHours(p.loggedHours, locale);
      const expected = formatHours(p.expectedHours, locale);
      return {
        title: t("ev.coverageLow.title", { pct: formatPct(p.coveragePct) }),
        body: t("ev.coverageLow.body", {
          logged,
          expected,
          day: formatDayLabel(p.date, locale),
          threshold: p.threshold,
        }),
        url: `${COVERAGE_URL}?period=day&date=${p.date}`,
        facts: [
          {
            name: t("ev.factLogged"),
            value: t("ev.hoursShort", { hours: logged }),
          },
          {
            name: t("ev.factWorkTime"),
            value: t("ev.hoursShort", { hours: expected }),
          },
          { name: t("ev.factCoverage"), value: formatPct(p.coveragePct) },
        ],
      };
    },
  },
  "compliance.warning": {
    group: "compliance",
    audience: "manager",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      const week = formatWeekLabel(p.weekStart, locale);
      return {
        title: t("ev.compliance.title"),
        body: t("ev.compliance.body", {
          employee: p.employeeName,
          week,
          findings: p.findings.join(" · "),
        }),
        url: TEAM_URL,
        facts: [
          { name: t("ev.factEmployee"), value: p.employeeName },
          { name: t("ev.factWeek"), value: week },
          ...p.findings.map((f) => ({ name: t("ev.factFinding"), value: f })),
        ],
      };
    },
  },
  "compliance.forecast": {
    group: "compliance",
    audience: "manager",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      const values = {
        week: formatWeekLabel(p.weekStart, locale),
        findings: p.findings.join(" · "),
      };
      return {
        title: t("ev.forecast.title"),
        body: p.employeeName
          ? t("ev.forecast.bodyNamed", { ...values, employee: p.employeeName })
          : t("ev.forecast.body", values),
        url: "/dashboard/enterprise/work-plan",
        facts: p.findings.map((f) => ({ name: t("ev.factFinding"), value: f })),
      };
    },
  },
  "digest.manager": {
    group: "digest",
    audience: "manager",
    render: (p, locale) => {
      const t = mailT("notifications", locale);
      const lines = [
        ...digestLines(t("ev.digestMissing"), p.missingTimesheets, locale),
        ...digestLines(t("ev.digestPendingTs"), p.pendingTimesheets, locale),
        ...digestLines(t("ev.digestPendingAbs"), p.pendingAbsence, locale),
      ];
      const titleKey = p.escalated
        ? p.period === "daily"
          ? "ev.digestDailyEsc"
          : "ev.digestWeeklyEsc"
        : p.period === "daily"
          ? "ev.digestDaily"
          : "ev.digestWeekly";
      return {
        title: t(titleKey),
        body: lines.length > 0 ? lines.join("\n") : t("ev.digestEmpty"),
        url: TEAM_URL,
        facts: [
          {
            name: t("ev.digestMissing"),
            value: String(p.missingTimesheets.length),
          },
          {
            name: t("ev.digestPendingTs"),
            value: String(p.pendingTimesheets.length),
          },
          {
            name: t("ev.digestFactAbs"),
            value: String(p.pendingAbsence.length),
          },
        ],
      };
    },
  },
};

export function eventGroup(event: NotificationEvent): NotificationGroup {
  return EVENT_DEFINITIONS[event].group;
}

export function eventAudience(event: NotificationEvent): NotificationAudience {
  return EVENT_DEFINITIONS[event].audience;
}

/** `locale` er modtagerens sprog; uden angivelse dansk. */
export function renderNotification<E extends NotificationEvent>(
  event: E,
  payload: NotificationPayloads[E],
  locale = "da",
): RenderedNotification {
  return EVENT_DEFINITIONS[event].render(payload, locale);
}
