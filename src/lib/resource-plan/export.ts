// Ressourceplan (#508): fælles data-form for grid, print-side og CSV, plus
// CSV-eksporten. Ren TS — bruges fra klienten (download) og testes direkte.

import { toIntlLocale } from "@/i18n/format-locale";
import { sharedT } from "@/i18n/shared-text";
import { currentSyncLocale } from "@/i18n/sync-text";
import { escapeCsv } from "@/lib/utils/spreadsheet";
import {
  bookingStatus,
  isoWeekNumber,
  type PlanRow,
  sumValues,
  type WeekCapacity,
  weekEnd,
} from "./plan";

export type ResourcePlanPreset = "grid" | "opgaveoversigt";

export const PRESET_LABELS: Record<ResourcePlanPreset, string> = {
  grid: "Plan mod registreret pr. uge",
  opgaveoversigt: "Opgaveoversigt (undervisere)",
};

function rp(key: string, values?: Record<string, string | number>): string {
  return sharedT("sharedReports", `resourcePlan.${key}`, values);
}

export interface ResourcePlanMember {
  userId: string;
  name: string;
  /** Kapacitet pr. uge (nøgle = mandagen) */
  capacity: Record<string, WeekCapacity>;
}

export interface ResourcePlanGridRow extends PlanRow {
  projectName: string;
  clientName: string | null;
  activityName: string | null;
}

export interface ResourcePlanGrid {
  weeks: string[];
  today: string;
  members: ResourcePlanMember[];
  rows: ResourcePlanGridRow[];
}

/** "7,5" — dansk decimalkomma, højst to decimaler. */
export function formatHours(
  h: number,
  locale = toIntlLocale(currentSyncLocale()),
): string {
  return (Math.round(h * 100) / 100).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: false,
  });
}

export function weekLabel(weekStart: string): string {
  return rp("week", { week: isoWeekNumber(weekStart) });
}

/** Planlagt i alt pr. uge for en medarbejder (på tværs af projekter). */
export function memberWeekTotals(
  rows: readonly PlanRow[],
  userId: string,
  weeks: readonly string[],
): { planned: Record<string, number>; registered: Record<string, number> } {
  const planned: Record<string, number> = {};
  const registered: Record<string, number> = {};
  for (const w of weeks) {
    planned[w] = 0;
    registered[w] = 0;
  }
  for (const r of rows) {
    if (r.userId !== userId) continue;
    for (const w of weeks) {
      planned[w] += r.planned[w] ?? 0;
      registered[w] += r.registered[w] ?? 0;
    }
  }
  for (const w of weeks) {
    planned[w] = Math.round(planned[w] * 100) / 100;
    registered[w] = Math.round(registered[w] * 100) / 100;
  }
  return { planned, registered };
}

function bookingLabel(status: "over" | "under" | "ok" | "none"): string {
  return status === "none" ? "" : rp(status);
}

const DELIM = ";";

/**
 * Celle til CSV: citeres ved skilletegn/anførselstegn/linjeskift, og tekst
 * der starter med =, +, - eller @ får et ' foran, så regneark ikke tolker
 * et projektnavn som en formel.
 */
export function csvCell(value: string | number): string {
  if (typeof value === "number") return formatHours(value);
  return escapeCsv(value, { quoteComma: true });
}

function line(cells: Array<string | number>): string {
  return cells.map(csvCell).join(DELIM);
}

function rowsByMember(grid: ResourcePlanGrid, userId: string) {
  return grid.rows
    .filter((r) => r.userId === userId)
    .sort(
      (a, b) =>
        a.projectName.localeCompare(b.projectName, currentSyncLocale()) ||
        (a.activityName ?? "").localeCompare(
          b.activityName ?? "",
          currentSyncLocale(),
        ),
    );
}

/** Uge-grid: plan og registreret pr. række og uge + kapacitet pr. medarbejder. */
function gridCsv(grid: ResourcePlanGrid): string[] {
  const { weeks } = grid;
  const out = [
    line([
      rp("member"),
      rp("project"),
      rp("client"),
      rp("activity"),
      rp("line"),
      ...weeks.map((w) => `${weekLabel(w)} (${w})`),
      rp("total"),
    ]),
  ];
  for (const m of grid.members) {
    const totals = memberWeekTotals(grid.rows, m.userId, weeks);
    const cap = weeks.map((w) => m.capacity[w]?.capacity ?? 0);
    out.push(
      line([
        m.name,
        "",
        "",
        "",
        rp("capacity"),
        ...cap,
        cap.reduce((a, b) => a + b, 0),
      ]),
      line([
        m.name,
        "",
        "",
        "",
        rp("plannedTotal"),
        ...weeks.map((w) => totals.planned[w]),
        sumValues(totals.planned),
      ]),
      line([
        m.name,
        "",
        "",
        "",
        rp("booking"),
        ...weeks.map((w, i) =>
          bookingLabel(bookingStatus(totals.planned[w], cap[i])),
        ),
        "",
      ]),
    );
    for (const r of rowsByMember(grid, m.userId)) {
      const base = [
        m.name,
        r.projectName,
        r.clientName ?? "",
        r.activityName ?? "",
      ];
      out.push(
        line([
          ...base,
          rp("planned"),
          ...weeks.map((w) => r.planned[w] ?? 0),
          sumValues(r.planned),
        ]),
        line([
          ...base,
          rp("registered"),
          ...weeks.map((w) => r.registered[w] ?? 0),
          sumValues(r.registered),
        ]),
      );
    }
  }
  return out;
}

/**
 * Opgaveoversigt (forudindstilling til statussamtaler, oprindeligt kunde C-
 * undervisere): én linje pr. opgave med planlagt og registreret i perioden,
 * og en sumlinje med normtid, fravær og kapacitet.
 */
function opgaveoversigtCsv(grid: ResourcePlanGrid): string[] {
  const { weeks } = grid;
  const from = weeks[0];
  const to = weekEnd(weeks[weeks.length - 1]);
  const out = [
    line([rp("overviewTitle", { from, to })]),
    line([
      rp("member"),
      rp("task"),
      rp("client"),
      rp("activity"),
      rp("plannedH"),
      rp("registeredH"),
      rp("deviationH"),
    ]),
  ];
  for (const m of grid.members) {
    let planned = 0;
    let registered = 0;
    for (const r of rowsByMember(grid, m.userId)) {
      const p = sumValues(r.planned);
      const reg = sumValues(r.registered);
      planned += p;
      registered += reg;
      out.push(
        line([
          m.name,
          r.projectName,
          r.clientName ?? "",
          r.activityName ?? "",
          p,
          reg,
          reg - p,
        ]),
      );
    }
    let norm = 0;
    let absence = 0;
    let capacity = 0;
    for (const w of weeks) {
      norm += m.capacity[w]?.normHours ?? 0;
      absence += m.capacity[w]?.absenceHours ?? 0;
      capacity += m.capacity[w]?.capacity ?? 0;
    }
    out.push(
      line([
        m.name,
        rp("total"),
        "",
        "",
        planned,
        registered,
        registered - planned,
      ]),
      line([
        m.name,
        rp("summaryLine", {
          norm: formatHours(norm),
          absence: formatHours(absence),
          capacity: formatHours(capacity),
          unplanned: formatHours(Math.max(0, capacity - planned)),
        }),
      ]),
    );
  }
  return out;
}

/** CSV med BOM og semikolon (åbner direkte i dansk Excel). */
export function resourcePlanCsv(
  grid: ResourcePlanGrid,
  preset: ResourcePlanPreset,
): string {
  const lines =
    preset === "opgaveoversigt" ? opgaveoversigtCsv(grid) : gridCsv(grid);
  return `﻿${lines.join("\r\n")}\r\n`;
}
