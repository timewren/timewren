"use client";

import { ClipboardList } from "lucide-react";
import { createTranslator, useLocale, useTranslations } from "next-intl";
import { useBrand } from "@/components/BrandContext";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { toIntlLocale } from "@/i18n/format-locale";
import daAudit from "@/i18n/messages/da/enterpriseAudit.json";
import { brand as buildBrand } from "@/lib/brand";
import {
  AUDIT_ACTION_CATEGORY,
  type OrgAuditAction,
  type OrgAuditCategory,
} from "@/lib/org-audit";

/**
 * Fælles visning af org-audit-poster (#466): aktivitetslog, medarbejderens
 * "Historik"-fane og teamsiden. Label pr. action, læsbar detalje og
 * før/efter-diff for redigeringer. Funktionerne tager en valgfri oversætter
 * (`useTranslations("enterpriseAudit")`); uden den bruges dansk.
 */

export type AuditT = (
  key: string,
  values?: Record<string, string | number>,
) => string;

const danishT = createTranslator({
  locale: "da",
  messages: { enterpriseAudit: daAudit },
  namespace: "enterpriseAudit",
}) as unknown as AuditT;

export type AuditEntry = {
  id: string;
  action: string;
  createdAt: Date | string;
  targetEmail?: string | null;
  targetUserId?: string | null;
  metadata?: unknown;
  /** Snapshot af aktørens navn/e-mail — vises når brugeren er slettet (#479) */
  actorLabel?: string | null;
  actor?: {
    id: string;
    name: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
};

type Diff = Record<string, { from: unknown; to: unknown }>;

const FIELD_KEYS = [
  "role",
  "employmentType",
  "weeklyHours",
  "workingDays",
  "startDate",
  "endDate",
  "departmentId",
  "managerId",
  "isSelfScheduler",
  "isActive",
  "dailyNormHours",
  "breakMinutes",
  "absenceTypeId",
  "halfDayStart",
  "halfDayEnd",
  "note",
  "totalDays",
  "name",
  "color",
  "payrollCode",
  "isDefault",
  "isArchived",
  "defaultBillable",
  "overtimeThresholdHours",
  "vacationOverdraftDays",
  "vacationYearStartMonth",
  "vacationAccrualMode",
  "vacationCarryOverMaxDays",
  "vacationPayOutRemaining",
  "defaultWeeklyHours",
  "breakMinutesPerDay",
  "breakPolicy",
  "hours",
  "date",
  "description",
  "projectId",
  "clientId",
  "activityTypeId",
  "kind",
  "startTime",
  "endTime",
];

const CATEGORY_COLORS: Record<OrgAuditCategory, string> = {
  members: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  settings:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  time: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  billing:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  absence: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  employees:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300",
  timesheets:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  security: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export function auditBadgeClass(action: string): string {
  const cat = AUDIT_ACTION_CATEGORY[action as OrgAuditAction];
  return cat
    ? CATEGORY_COLORS[cat]
    : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
}

export function auditLabel(action: string, t: AuditT = danishT): string {
  return action in AUDIT_ACTION_CATEGORY ? t(`actions.${action}`) : action;
}

function fmtValue(v: unknown, t: AuditT): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "boolean") return v ? t("yes") : t("no");
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fmtDate(d: unknown, intl: string): string {
  if (typeof d !== "string") return "";
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString(intl, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtPeriod(
  start: unknown,
  end: unknown,
  t: AuditT,
  intl: string,
): string {
  const s = fmtDate(start, intl);
  if (!end) return t("detail.openPeriod", { date: s });
  const e = fmtDate(end, intl);
  return s === e ? s : `${s}–${e}`;
}

const POOL_KEYS = ["vacation", "extra"];
const ADJUST_REASON_KEYS = [
  "absence_approved",
  "absence_auto_approved",
  "absence_cancelled",
  "absence_reported_well",
  "manual",
];

/** "2026" eller "Ferieår 2025/26" ud fra periodens startdato; fallback til år. */
function periodText(meta: Record<string, unknown>, t: AuditT): string {
  const start = meta.periodStart;
  if (typeof start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
    const y = Number(start.slice(0, 4));
    const m = Number(start.slice(5, 7));
    return m === 1
      ? String(y)
      : t("holidayYear", { from: y, to: String(y + 1).slice(2) });
  }
  return meta.year != null ? String(meta.year) : "";
}

/** Kort, læsbar detalje pr. action. Tomt hvis intet meningsfuldt. */
export function auditDetailText(
  log: AuditEntry,
  t: AuditT = danishT,
  locale = toIntlLocale("da"),
  /** Hostens brand (useBrand().name); udeladt = build-brandet. */
  brandName: string = buildBrand.name,
): string {
  const meta = (log.metadata ?? {}) as Record<string, unknown>;
  const fd = (d: unknown) => fmtDate(d, locale);
  const fp = (a: unknown, b: unknown) => fmtPeriod(a, b, t, locale);
  const num = (n: number) => n.toLocaleString(locale);
  switch (log.action) {
    case "member_invited":
      return meta.role
        ? t("detail.invitedAs", {
            email: log.targetEmail || "",
            role: String(meta.role),
          })
        : log.targetEmail || "";
    case "member_removed":
      return (meta.name as string) || log.targetUserId || "";
    case "member_role_changed":
      return `${(meta.name as string) || ""}: ${meta.oldRole ?? ""} → ${meta.newRole ?? ""}`;
    case "invitation_cancelled":
      return log.targetEmail || "";
    case "org_updated":
      return (meta.field as string) || "";
    case "module_toggled":
      return t("detail.moduleToggled", {
        module: String(meta.moduleKey ?? ""),
        state: meta.enabled ? t("detail.enabled") : t("detail.disabled"),
      });
    case "absence_registered":
    case "absence_request_created":
    case "absence_request_approved":
    case "absence_request_rejected":
    case "absence_request_cancelled": {
      const period = meta.date
        ? fd(meta.date)
        : fp(meta.startDate, meta.endDate);
      const extra: string[] = [];
      if (meta.onBehalf) extra.push(t("detail.onBehalf"));
      if (meta.source === "timesheet") extra.push(t("detail.viaTimesheet"));
      if (typeof meta.hoursPerDay === "number")
        extra.push(t("detail.hoursPerDay", { hours: meta.hoursPerDay }));
      if (typeof meta.reason === "string" && meta.reason)
        extra.push(t("detail.reason", { reason: meta.reason }));
      return [period, ...extra].filter(Boolean).join(" · ");
    }
    case "absence_request_updated":
      return "";
    case "absence_reported_well":
      return `${t("detail.reportedWell", { date: fd(meta.lastSickDate) })}${meta.onBehalf ? t("detail.registeredByManager") : ""}`;
    case "vacation_balance_adjusted": {
      const delta = Number(meta.deltaDays ?? 0);
      const sign = delta > 0 ? "−" : "+";
      const reason = ADJUST_REASON_KEYS.includes(String(meta.reason))
        ? t(`adjustReason.${meta.reason}`)
        : (meta.reason ?? "");
      const note =
        typeof meta.note === "string" && meta.note ? ` · ${meta.note}` : "";
      const pool = POOL_KEYS.includes(String(meta.pool))
        ? t(`pool.${meta.pool}`)
        : t("pool.days");
      return `${t("detail.adjust", {
        sign,
        days: num(Math.abs(delta)),
        pool,
        period: periodText(meta, t),
        reason: String(reason),
      })}${note}`;
    }
    case "vacation_year_rolled_over": {
      const v = (meta.vacation ?? {}) as Record<string, number>;
      const parts = [
        v.carry ? t("detail.carried", { value: num(v.carry) }) : null,
        v.forfeited ? t("detail.forfeited", { value: num(v.forfeited) }) : null,
        v.paidOut ? t("detail.paidOut", { value: num(v.paidOut) }) : null,
      ].filter(Boolean);
      return `${periodText({ periodStart: meta.fromPeriodStart }, t)} → ${periodText({ periodStart: meta.toPeriodStart }, t)}${parts.length ? t("detail.rolloverHoliday", { parts: parts.join(", ") }) : ""}`;
    }
    case "employee_profile_created":
      return meta.source === "import"
        ? `${t("detail.viaImport")}${meta.weeklyHours ? ` · ${t("detail.perWeek", { hours: String(meta.weeklyHours) })}` : ""}`
        : meta.weeklyHours
          ? t("detail.perWeek", { hours: String(meta.weeklyHours) })
          : "";
    case "department_managers_updated": {
      const before = (meta.before as string[]) ?? [];
      const after = (meta.after as string[]) ?? [];
      return t("detail.managersChanged", {
        before: before.length,
        after: after.length,
      });
    }
    case "closure_period_created":
      return `${meta.name ?? ""} · ${fp(meta.startDate, meta.endDate)} · ${t("detail.employeesAffected", { count: Number(meta.affected ?? 0) })}`;
    case "closure_period_deleted":
      return `${meta.name ?? ""} · ${fp(meta.startDate, meta.endDate)}`;
    case "activity_type_created":
    case "activity_type_updated":
    case "activity_type_archived":
      return (meta.name as string) || "";
    case "timesheet_week_submitted":
    case "timesheet_week_approved":
    case "timesheet_week_rejected":
    case "timesheet_week_reopened": {
      const parts = [t("detail.weekFrom", { date: fd(meta.weekStart) })];
      if (typeof meta.totalHours === "number")
        parts.push(t("detail.hoursShort", { hours: num(meta.totalHours) }));
      if (typeof meta.reason === "string" && meta.reason)
        parts.push(t("detail.reason", { reason: meta.reason }));
      return parts.join(" · ");
    }
    case "work_plan_created":
    case "work_plan_updated":
    case "work_plan_archived":
      return [
        (meta.name as string) || "",
        meta.validFrom
          ? t("detail.validFrom", { date: fd(meta.validFrom) })
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
    case "work_plan_assigned":
      return [
        meta.planName ? String(meta.planName) : t("detail.noPlan"),
        meta.departmentName
          ? t("detail.department", { name: String(meta.departmentName) })
          : "",
        meta.validFrom ? t("detail.from", { date: fd(meta.validFrom) }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
    case "work_day_deviation_set":
    case "work_day_deviation_cleared":
      return [
        fd(meta.date),
        meta.onBehalf ? t("detail.fixedByManager") : "",
        meta.noteChanged ? t("detail.noteChanged") : "",
      ]
        .filter(Boolean)
        .join(" · ");
    case "admin_impersonation_started":
      return t("detail.impersonation", {
        name: (meta.targetName as string) || log.targetEmail || "",
        brand: brandName,
      });
    case "mcp_app_connected":
    case "mcp_app_revoked":
      return (meta.clientName as string) || "";
    case "time_entry_updated":
    case "time_entry_deleted":
      return meta.date ? fd(meta.date) : "";
    default:
      return "";
  }
}

export function auditDiffOf(log: AuditEntry): Diff | null {
  const meta = (log.metadata ?? {}) as Record<string, unknown>;
  const diff = meta.diff;
  if (!diff || typeof diff !== "object") return null;
  const entries = Object.entries(diff as Diff);
  return entries.length > 0 ? (diff as Diff) : null;
}

export function AuditDiffView({ diff, t }: { diff: Diff; t?: AuditT }) {
  const hookT = useTranslations("enterpriseAudit") as unknown as AuditT;
  const tr = t ?? hookT;
  return (
    <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]">
      {Object.entries(diff).map(([key, { from, to }]) => (
        <div key={key} className="contents">
          <dt className="text-gray-500 dark:text-gray-400">
            {FIELD_KEYS.includes(key) ? tr(`fields.${key}`) : key}
          </dt>
          <dd className="text-gray-800 dark:text-gray-200">
            <span className="line-through opacity-60">
              {fmtValue(from, tr)}
            </span>
            {" → "}
            <span className="font-medium">{fmtValue(to, tr)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function formatAuditTime(
  date: Date | string,
  locale = toIntlLocale("da"),
): string {
  return new Date(date).toLocaleString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AuditEntryList({
  entries,
  emptyText,
}: {
  entries: AuditEntry[];
  emptyText?: string;
}) {
  const t = useTranslations("enterpriseAudit") as unknown as AuditT;
  const intl = toIntlLocale(useLocale());
  const brand = useBrand();
  if (entries.length === 0) {
    return (
      <div className="p-8 text-center">
        <ClipboardList className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          {emptyText ?? t("emptyDefault")}
        </p>
      </div>
    );
  }
  return (
    <ol className="divide-y divide-gray-100 dark:divide-gray-800">
      {entries.map((log) => {
        const diff = auditDiffOf(log);
        const detail = auditDetailText(log, t, intl, brand.name);
        return (
          <li key={log.id} className="flex gap-3 px-4 py-3">
            <UserAvatar
              name={log.actor?.name}
              image={log.actor?.image}
              size="xs"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${auditBadgeClass(log.action)}`}
                >
                  {auditLabel(log.action, t)}
                </span>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {log.actor?.name || log.actorLabel || t("unknown")}
                </span>
                <time
                  dateTime={new Date(log.createdAt).toISOString()}
                  className="text-xs text-gray-500 dark:text-gray-400"
                >
                  {formatAuditTime(log.createdAt, intl)}
                </time>
              </div>
              {detail && (
                <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                  {detail}
                </p>
              )}
              {diff && <AuditDiffView diff={diff} t={t} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
