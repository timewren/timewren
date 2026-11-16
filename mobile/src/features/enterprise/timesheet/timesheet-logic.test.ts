import type { TimesheetWeek } from './timesheet-logic';
import {
  absenceForDay,
  allowedActivities,
  applyCellLocally,
  expectedWeekHours,
  mergeRows,
  rowKey,
} from './timesheet-logic';

const week = {
  days: ['2026-09-07', '2026-09-08'],
  rows: [
    {
      projectId: 'p1',
      projectName: 'Beta',
      activityTypeId: 'a1',
      activityName: 'Udvikling',
      activityColor: '#000',
      source: 'entries',
      hidden: false,
      days: { '2026-09-07': { total: 5, timesheetHours: 3, note: 'x' } },
    },
    {
      projectId: 'p2',
      projectName: 'Alfa',
      activityTypeId: null,
      activityName: null,
      activityColor: null,
      source: 'all',
      hidden: true,
      days: {},
    },
  ],
  activityTypes: [
    { id: 'a1', name: 'Udvikling', color: '#000', sortOrder: 0 },
    { id: 'a2', name: 'Møde', color: null, sortOrder: 1 },
  ],
  allowedActivitiesByProject: { p1: ['a2'] },
  projects: [
    { id: 'p1', name: 'Beta' },
    { id: 'p2', name: 'Alfa' },
  ],
  absenceRows: [
    {
      absenceTypeId: 'f1',
      name: 'Ferie',
      color: '#7c3aed',
      requiresApproval: true,
      days: { '2026-09-08': { hours: 7.4, status: 'approved', requestId: 'r1', multiDay: false, closure: false } },
    },
  ],
  norms: { '2026-09-07': 7.4, '2026-09-08': 0 },
} as unknown as TimesheetWeek;

describe('timesheet-logic', () => {
  it('rowKey matcher web', () => {
    expect(rowKey('p1', 'a1')).toBe('p1|a1');
    expect(rowKey(null, null)).toBe('none|');
  });

  it('mergeRows skjuler hidden, tilføjer lokale og sorterer', () => {
    const rows = mergeRows(week, [
      { projectId: 'p2', activityTypeId: 'a2' },
      { projectId: 'p1', activityTypeId: 'a1' }, // findes allerede
    ]);
    expect(rows.map(r => `${r.projectName}/${r.activityName ?? '-'}`)).toEqual(['Alfa/Møde', 'Beta/Udvikling']);
    expect(rows[0]!.source).toBe('manual');
  });

  it('applyCellLocally sætter total og bevarer detaljerede timer', () => {
    const next = applyCellLocally(week, { projectId: 'p1', activityTypeId: 'a1', date: '2026-09-07', hours: 8 });
    const cell = next.rows[0]!.days['2026-09-07']!;
    expect(cell).toEqual({ total: 8, timesheetHours: 6, note: 'x' });
    // originalen røres ikke
    expect(week.rows[0]!.days['2026-09-07']!.total).toBe(5);
  });

  it('applyCellLocally kan ikke gå under detaljerede timer og rydder note med ""', () => {
    const next = applyCellLocally(week, { projectId: 'p1', activityTypeId: 'a1', date: '2026-09-07', hours: 1, note: '' });
    expect(next.rows[0]!.days['2026-09-07']).toEqual({ total: 2, timesheetHours: 0, note: null });
  });

  it('applyCellLocally opretter række der mangler', () => {
    const next = applyCellLocally(week, { projectId: 'p2', activityTypeId: 'a2', date: '2026-09-08', hours: 2, note: 'hej' });
    const row = next.rows.find(r => r.projectId === 'p2' && r.activityTypeId === 'a2')!;
    expect(row.projectName).toBe('Alfa');
    expect(row.activityName).toBe('Møde');
    expect(row.days['2026-09-08']).toEqual({ total: 2, timesheetHours: 2, note: 'hej' });
  });

  it('allowedActivities respekterer projektets liste', () => {
    expect(allowedActivities(week, 'p1').map(a => a.id)).toEqual(['a2']);
    expect(allowedActivities(week, 'p2').map(a => a.id)).toEqual(['a1', 'a2']);
  });

  it('expectedWeekHours og absenceForDay', () => {
    expect(expectedWeekHours(week.norms)).toBe(7.4);
    expect(absenceForDay(week.absenceRows, '2026-09-07')).toEqual([]);
    const abs = absenceForDay(week.absenceRows, '2026-09-08');
    expect(abs).toHaveLength(1);
    expect(abs[0]!.hours).toBe(7.4);
    expect(abs[0]!.status).toBe('approved');
  });
});
