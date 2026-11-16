/**
 * Leder-digest (E10, #468) — ren beregning: udestående timesedler og
 * anmodninger i et leder-scope + eskaleringsflag. Ingen DB-adgang.
 */

import { formatMailPeriod, mailT } from "@/lib/email/locale";
import type { DigestItem, NotificationPayloads } from "./events";
import { formatWeekLabel } from "./events";

export interface DigestSource {
  /** Aktive medarbejdere i org'en */
  employees: Array<{ userId: string; name: string }>;
  /** Sidste hele uge (mandag, YYYY-MM-DD) */
  lastWeekStart: string;
  /** userIds med indsendt/godkendt timeseddel for lastWeekStart */
  handledLastWeek: Set<string>;
  /** Timesedler der afventer godkendelse */
  pendingTimesheets: Array<{
    userId: string;
    weekStart: string;
    submittedAt: Date | null;
  }>;
  /** Fraværsanmodninger der afventer afgørelse */
  pendingAbsence: Array<{
    userId: string;
    typeName: string;
    startDate: string;
    endDate: string | null;
    createdAt: Date;
  }>;
  today: Date;
}

export function ageInDays(from: Date | null, today: Date): number {
  if (!from) return 0;
  return Math.max(0, Math.floor((today.getTime() - from.getTime()) / 86400000));
}

export interface BuildDigestInput {
  source: DigestSource;
  /** null = hele org'en */
  scopeUserIds: Set<string> | null;
  period: "daily" | "weekly";
  escalationDays: number | null;
  /** Modtagerens (lederens) sprog; standard dansk */
  locale?: string;
}

export function buildDigest(
  input: BuildDigestInput,
): NotificationPayloads["digest.manager"] {
  const { source, scopeUserIds, period, escalationDays, locale = "da" } = input;
  const t = mailT("notifications", locale);
  const inScope = (userId: string) =>
    scopeUserIds === null || scopeUserIds.has(userId);
  const nameOf = new Map(source.employees.map((e) => [e.userId, e.name]));
  const weekLabel = formatWeekLabel(source.lastWeekStart, locale);

  const missingTimesheets: DigestItem[] = source.employees
    .filter((e) => inScope(e.userId) && !source.handledLastWeek.has(e.userId))
    .map((e) => ({
      employeeName: e.name || t("unknown"),
      detail: t("digestItem.missing", { week: weekLabel }),
    }));

  const pendingTimesheets: DigestItem[] = source.pendingTimesheets
    .filter((ts) => inScope(ts.userId))
    .map((ts) => ({
      employeeName: nameOf.get(ts.userId) ?? t("unknown"),
      detail: t("digestItem.pendingTs", {
        week: formatWeekLabel(ts.weekStart, locale),
      }),
      ageDays: ageInDays(ts.submittedAt, source.today),
    }));

  const pendingAbsence: DigestItem[] = source.pendingAbsence
    .filter((a) => inScope(a.userId))
    .map((a) => ({
      employeeName: nameOf.get(a.userId) ?? t("unknown"),
      detail: t("digestItem.pendingAbs", {
        type: (a.typeName || t("absenceTypeFallback")).toLowerCase(),
        period: formatMailPeriod(a.startDate, a.endDate, locale),
      }),
      ageDays: ageInDays(a.createdAt, source.today),
    }));

  const escalated =
    escalationDays != null &&
    [...pendingTimesheets, ...pendingAbsence].some(
      (i) => (i.ageDays ?? 0) >= escalationDays,
    );

  return {
    period,
    missingTimesheets,
    pendingTimesheets,
    pendingAbsence,
    escalated,
  };
}

export function digestIsEmpty(
  d: NotificationPayloads["digest.manager"],
): boolean {
  return (
    d.missingTimesheets.length === 0 &&
    d.pendingTimesheets.length === 0 &&
    d.pendingAbsence.length === 0
  );
}
