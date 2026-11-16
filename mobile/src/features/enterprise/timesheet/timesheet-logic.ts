import type { RouterInputs, RouterOutputs } from '~/api/app-router';
import { intlLocale } from '~/lib/locale';
import { round2 } from './week';

export type TimesheetWeek = RouterOutputs['enterprise']['getTimesheetWeek'];
export type TimesheetRow = TimesheetWeek['rows'][number];
export type AbsenceRow = TimesheetWeek['absenceRows'][number];
export type SetCellInput = RouterInputs['enterprise']['setTimesheetCell'];

/** Stabil rækkenøgle (projekt, aktivitet) — samme som web's timesheetRowKey. */
export function rowKey(projectId: string | null, activityTypeId: string | null): string {
  return `${projectId ?? 'none'}|${activityTypeId ?? ''}`;
}

/** Lokalt tilføjet række (uden timer endnu) fra "Tilføj række". */
export type LocalRow = { projectId: string; activityTypeId: string | null };

/**
 * Rækker der vises for ugen: serverens synlige rækker + lokalt tilføjede
 * (som ikke allerede findes). Rækkefølge: projektnavn, derefter aktivitet.
 */
export function mergeRows(
  week: Pick<TimesheetWeek, 'rows' | 'projects' | 'activityTypes'>,
  localRows: readonly LocalRow[],
): TimesheetRow[] {
  const existing = new Set(week.rows.map(r => rowKey(r.projectId, r.activityTypeId)));
  const out: TimesheetRow[] = week.rows.filter(r => !r.hidden);
  for (const local of localRows) {
    const key = rowKey(local.projectId, local.activityTypeId);
    if (existing.has(key))
      continue;
    existing.add(key);
    out.push(makeRow(week, local));
  }
  return out.sort((a, b) => {
    const byProject = a.projectName.localeCompare(b.projectName, intlLocale());
    if (byProject !== 0)
      return byProject;
    return (a.activityName ?? '').localeCompare(b.activityName ?? '', intlLocale());
  });
}

function makeRow(
  week: Pick<TimesheetWeek, 'projects' | 'activityTypes'>,
  local: LocalRow,
): TimesheetRow {
  const project = week.projects.find(p => p.id === local.projectId);
  const activity = local.activityTypeId
    ? week.activityTypes.find(a => a.id === local.activityTypeId)
    : undefined;
  return {
    projectId: local.projectId,
    projectName: project?.name ?? '?',
    activityTypeId: local.activityTypeId,
    activityName: activity?.name ?? null,
    activityColor: activity?.color ?? null,
    source: 'manual',
    hidden: false,
    days: {},
  };
}

/**
 * Optimistisk celleopdatering i cachen: sæt dagstotalen for (projekt,
 * aktivitet, dato). Detaljerede registreringer (total − timesheetHours)
 * bevares som bund, som serveren gør.
 */
export function applyCellLocally(week: TimesheetWeek, input: SetCellInput): TimesheetWeek {
  const activityTypeId = input.activityTypeId ?? null;
  const key = rowKey(input.projectId, activityTypeId);
  const rows = week.rows.map(r => ({ ...r, days: { ...r.days } }));
  let row = rows.find(r => rowKey(r.projectId, r.activityTypeId) === key);
  if (!row) {
    row = makeRow(week, { projectId: input.projectId, activityTypeId });
    rows.push(row);
  }
  const prev = row.days[input.date] ?? { total: 0, timesheetHours: 0, note: null };
  const detailed = round2(Math.max(0, prev.total - prev.timesheetHours));
  const total = round2(Math.max(detailed, input.hours));
  row.days[input.date] = {
    total,
    timesheetHours: round2(total - detailed),
    note: input.note === undefined ? prev.note : (input.note === '' ? null : input.note),
  };
  row.hidden = false;
  return { ...week, rows };
}

/** Aktivitetstyper der må vælges for et projekt (tom tilladt-liste = alle). */
export function allowedActivities(
  week: Pick<TimesheetWeek, 'activityTypes' | 'allowedActivitiesByProject'>,
  projectId: string,
): TimesheetWeek['activityTypes'] {
  const allowed = week.allowedActivitiesByProject[projectId];
  if (!allowed || allowed.length === 0)
    return week.activityTypes;
  const set = new Set(allowed);
  return week.activityTypes.filter(a => set.has(a.id));
}

/** Forventede timer for ugen: sum af normerne (helligdage/fravær fratrukket). */
export function expectedWeekHours(norms: Record<string, number>): number {
  return round2(Object.values(norms).reduce((sum, n) => sum + n, 0));
}

/** Fraværsceller for én dag (kun dem med timer). */
export function absenceForDay(absenceRows: readonly AbsenceRow[], day: string): Array<{ row: AbsenceRow; hours: number; status: string }> {
  const out: Array<{ row: AbsenceRow; hours: number; status: string }> = [];
  for (const row of absenceRows) {
    const cell = row.days[day];
    if (cell && cell.hours > 0)
      out.push({ row, hours: cell.hours, status: cell.status });
  }
  return out;
}
