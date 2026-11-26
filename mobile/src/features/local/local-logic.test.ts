import type { LocalData, LocalEntry, LocalProject, LocalTimer } from './local-logic';
import {
  addMinutesToClock,
  applyClient,
  applyProject,
  computeStats,
  daysInRange,
  EMPTY_LOCAL_DATA,
  EMPTY_SELECTION,
  entriesOnDay,
  entriesToCsv,
  FALLBACK_DESCRIPTION,
  groupByDay,
  groupDaysByMonth,
  groupDaysForChart,
  hasLocalData,
  hoursPerDay,
  importCounts,
  manualRange,
  matchByName,
  normalizeClock,
  parseClock,
  periodRange,
  removeClient,
  removeProject,
  removeTag,
  secondsOnDay,
  selectionLabel,
  shiftAnchor,
  stopTimer,
  suggestRange,
  toggleTag,
  toTimeCreateInput,
  validateName,
} from './local-logic';

const at = (h: number, m = 0, day = 24) => new Date(2026, 8, day, h, m).toISOString();

function entry(id: string, [start, end]: [string, string], extra: Partial<LocalEntry> = {}): LocalEntry {
  return { ...EMPTY_SELECTION, id, startedAt: start, endedAt: end, createdAt: end, ...extra };
}

const project = (id: string, clientId: string | null): LocalProject => ({ id, name: `P ${id}`, clientId, createdAt: at(8) });

describe('validateName', () => {
  it('kræver web-grænserne', () => {
    expect(validateName('client', 'A', [])).toBe('too_short');
    expect(validateName('tag', 'A', [])).toBeNull();
    expect(validateName('tag', 'x'.repeat(51), [])).toBe('too_long');
    expect(validateName('project', '  Web  ', [])).toBeNull();
  });
  it('fanger dubletter uanset store/små bogstaver og mellemrum', () => {
    expect(validateName('client', ' acme ', [{ name: 'ACME' }])).toBe('duplicate');
  });
});

describe('stopTimer', () => {
  const timer: LocalTimer = { ...EMPTY_SELECTION, description: ' Møde ', tagIds: ['t1'], startedAt: at(9) };
  it('laver en post med trimmet beskrivelse', () => {
    const e = stopTimer(timer, new Date(at(10, 30)), 'e1');
    expect(e).toMatchObject({ id: 'e1', description: 'Møde', startedAt: at(9), endedAt: at(10, 30), tagIds: ['t1'] });
  });
  it('kasserer under ét minut', () => {
    expect(stopTimer(timer, new Date(Date.parse(at(9)) + 59_000), 'e1')).toBeNull();
  });
});

describe('valg af projekt/kunde', () => {
  const projects = [project('p1', 'c1'), project('p2', null)];
  it('projekt trækker sin kunde med', () => {
    expect(applyProject(EMPTY_SELECTION, projects[0]!)).toMatchObject({ projectId: 'p1', clientId: 'c1' });
  });
  it('kundeløst projekt beholder valgt kunde', () => {
    expect(applyProject({ ...EMPTY_SELECTION, clientId: 'c9' }, projects[1]!)).toMatchObject({ projectId: 'p2', clientId: 'c9' });
  });
  it('anden kunde slipper projekt fra en anden kunde', () => {
    const sel = { ...EMPTY_SELECTION, projectId: 'p1', clientId: 'c1' };
    expect(applyClient(sel, 'c2', projects)).toMatchObject({ clientId: 'c2', projectId: null });
    expect(applyClient({ ...sel, projectId: 'p2' }, 'c2', projects)).toMatchObject({ projectId: 'p2' });
  });
  it('toggleTag slår til og fra', () => {
    const on = toggleTag(EMPTY_SELECTION, 't1');
    expect(on.tagIds).toEqual(['t1']);
    expect(toggleTag(on, 't1').tagIds).toEqual([]);
  });
  it('selectionLabel', () => {
    const data = { clients: [{ id: 'c1', name: 'Acme', createdAt: '' }], projects };
    expect(selectionLabel(data, { projectId: 'p1', clientId: 'c1' })).toBe('P p1 · Acme');
    expect(selectionLabel(data, { projectId: null, clientId: null })).toBeNull();
  });
});

describe('sletning mister aldrig tid', () => {
  const data: LocalData = {
    clients: [{ id: 'c1', name: 'Acme', createdAt: '' }],
    projects: [project('p1', 'c1')],
    tags: [{ id: 't1', name: 'Møde', color: '#2563eb', createdAt: '' }],
    entries: [entry('e1', [at(9), at(10)], { projectId: 'p1', clientId: 'c1', tagIds: ['t1'] })],
    timer: { ...EMPTY_SELECTION, projectId: 'p1', clientId: 'c1', tagIds: ['t1'], startedAt: at(11) },
  };
  it('kunde', () => {
    const next = removeClient(data, 'c1');
    expect(next.clients).toEqual([]);
    expect(next.projects[0]!.clientId).toBeNull();
    expect(next.entries[0]).toMatchObject({ clientId: null, projectId: 'p1' });
    expect(next.timer?.clientId).toBeNull();
  });
  it('projekt', () => {
    const next = removeProject(data, 'p1');
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]!.projectId).toBeNull();
    expect(next.timer?.projectId).toBeNull();
  });
  it('tag', () => {
    const next = removeTag(data, 't1');
    expect(next.entries[0]!.tagIds).toEqual([]);
    expect(next.timer?.tagIds).toEqual([]);
  });
});

describe('dage', () => {
  const entries = [
    entry('a', [at(9, 0, 23), at(10, 0, 23)]),
    entry('b', [at(9), at(9, 30)]),
    entry('c', [at(13), at(15)]),
  ];
  it('grupperer nyeste først med summer', () => {
    const groups = groupByDay(entries);
    expect(groups.map(g => g.key)).toEqual(['2026-09-24', '2026-09-23']);
    expect(groups[0]!.seconds).toBe(2.5 * 3600);
    expect(groups[0]!.entries.map(e => e.id)).toEqual(['c', 'b']);
  });
  it('secondsOnDay', () => {
    expect(secondsOnDay(entries, new Date(2026, 8, 23))).toBe(3600);
  });
});

describe('parseClock / manualRange', () => {
  it.each([
    ['8', 480],
    ['830', 510],
    ['08:30', 510],
    ['8.30', 510],
    ['2359', 1439],
  ])('%s → %i', (input, minutes) => {
    expect(parseClock(input)).toBe(minutes);
  });
  it.each(['', '24', '8:75', 'abc', '12345'])('afviser %p', (input) => {
    expect(parseClock(input)).toBeNull();
  });
  it('bygger ISO-tidsrum og håndterer midnat', () => {
    expect(manualRange('2026-09-24', '9', '10:30')).toEqual({ startedAt: at(9), endedAt: at(10, 30) });
    expect(manualRange('2026-09-24', '23', '1')).toEqual({ startedAt: at(23), endedAt: at(1, 0, 25) });
    expect(manualRange('2026-09-24', '9', '9')).toEqual({ error: 'zero' });
    expect(manualRange('2026-09-24', 'x', '9')).toEqual({ error: 'invalid_time' });
  });
});

describe('overførsel', () => {
  it('mapper til time.create-input', () => {
    const e = entry('e1', [at(9), at(9, 20)], { projectId: 'p1', clientId: 'c1' });
    expect(toTimeCreateInput(e, { p1: 'P', c1: 'C' })).toEqual({
      clientEntryId: e.id,
      description: FALLBACK_DESCRIPTION,
      hours: 0.33,
      date: '2026-09-24',
      startTime: at(9),
      endTime: at(9, 20),
      projectId: 'P',
      clientId: 'C',
    });
  });
  it('udelader koblinger uden server-id', () => {
    const e = entry('e1', [at(9), at(10)], { projectId: 'p1', description: 'Kode' });
    expect(toTimeCreateInput(e, {})).toMatchObject({ projectId: undefined, clientId: undefined, description: 'Kode', hours: 1 });
  });
  it('matchByName', () => {
    expect(matchByName([{ id: 'x', name: 'Acme ' }], 'acme')).toBe('x');
    expect(matchByName([{ id: 'x', name: 'Acme' }], 'Other')).toBeNull();
  });
  it('tæller og registrerer data', () => {
    expect(hasLocalData(EMPTY_LOCAL_DATA)).toBe(false);
    const data = { ...EMPTY_LOCAL_DATA, entries: [entry('a', [at(9), at(10)])] };
    expect(hasLocalData(data)).toBe(true);
    expect(importCounts(data)).toMatchObject({ entries: 1, seconds: 3600 });
  });
});

describe('dage og hurtig indtastning', () => {
  const entries = [
    entry('a', [at(9), at(11)]),
    entry('b', [at(12), at(13, 30)]),
    entry('c', [at(8, 0, 23), at(9, 0, 23)]),
  ];
  it('entriesOnDay sorterer ældste først', () => {
    expect(entriesOnDay(entries, '2026-09-24').map(e => e.id)).toEqual(['a', 'b']);
  });
  it('hoursPerDay', () => {
    expect(hoursPerDay(entries, ['2026-09-23', '2026-09-24', '2026-09-25'])).toEqual({ '2026-09-23': 1, '2026-09-24': 3.5, '2026-09-25': 0 });
  });
  it('addMinutesToClock og normalizeClock', () => {
    expect(addMinutesToClock('9', 90)).toBe('10:30');
    expect(addMinutesToClock('23:30', 60)).toBe('00:30');
    expect(addMinutesToClock('x', 60)).toBeNull();
    expect(normalizeClock('830')).toBe('08:30');
    expect(normalizeClock('8:7')).toBe('8:7');
  });
  it('suggestRange fortsætter efter dagens seneste post', () => {
    expect(suggestRange(entries, '2026-09-24', new Date(2026, 8, 26, 10))).toEqual({ from: '13:30', to: '14:30' });
  });
  it('suggestRange på tom dag starter 08:00', () => {
    expect(suggestRange(entries, '2026-09-22', new Date(2026, 8, 26, 10))).toEqual({ from: '08:00', to: '09:00' });
  });
  it('suggestRange i dag slutter nu', () => {
    expect(suggestRange([], '2026-09-26', new Date(2026, 8, 26, 10, 15))).toEqual({ from: '08:00', to: '10:15' });
  });
});

describe('statistik', () => {
  it('periodRange uge og måned', () => {
    expect(periodRange('week', new Date(2026, 8, 24))).toEqual({ start: '2026-09-21', end: '2026-09-27' });
    expect(periodRange('week', new Date(2026, 8, 27))).toEqual({ start: '2026-09-21', end: '2026-09-27' });
    expect(periodRange('month', new Date(2026, 1, 10))).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
  it('shiftAnchor', () => {
    expect(periodRange('week', shiftAnchor('week', new Date(2026, 8, 24), -1)).start).toBe('2026-09-14');
    expect(periodRange('month', shiftAnchor('month', new Date(2026, 0, 31), 1))).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });
  it('daysInRange inkl. ender og ombytning', () => {
    expect(daysInRange({ start: '2026-09-29', end: '2026-10-02' })).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(daysInRange({ start: '2026-09-02', end: '2026-09-01' })).toEqual(['2026-09-01', '2026-09-02']);
  });
  it('computeStats fordeler på dag, projekt, kunde og tag', () => {
    const data = {
      projects: [project('p1', 'c1')],
      clients: [{ id: 'c1', name: 'Acme', createdAt: '' }],
      tags: [{ id: 't1', name: 'Møde', color: '#2563eb', createdAt: '' }],
      entries: [
        entry('a', [at(9), at(11)], { projectId: 'p1', clientId: 'c1', tagIds: ['t1'] }),
        entry('b', [at(9, 0, 22), at(10, 0, 22)]),
        entry('c', [at(9, 0, 30), at(10, 0, 30)]),
      ],
    };
    const s = computeStats(data, { start: '2026-09-21', end: '2026-09-27' }, 'Ingen');
    expect(s.totalSeconds).toBe(3 * 3600);
    expect(s.count).toBe(2);
    expect(s.activeDays).toBe(2);
    expect(s.byDay).toHaveLength(7);
    expect(s.byProject).toEqual([{ id: 'p1', name: 'P p1', seconds: 7200, color: undefined }, { id: null, name: 'Ingen', seconds: 3600, color: undefined }]);
    expect(s.byClient[0]).toMatchObject({ name: 'Acme', seconds: 7200 });
    expect(s.byTag).toEqual([{ id: 't1', name: 'Møde', seconds: 7200, color: '#2563eb' }]);
  });
  it('groupDaysForChart samler lange perioder pr. uge', () => {
    const days = daysInRange({ start: '2026-09-01', end: '2026-10-31' }).map(key => ({ key, seconds: 3600 }));
    const g = groupDaysForChart(days);
    expect(g.length).toBeLessThanOrEqual(10);
    expect(g.reduce((a, b) => a + b.seconds, 0)).toBe(days.length * 3600);
    expect(groupDaysForChart(days.slice(0, 7))).toHaveLength(7);
  });
});

describe('år og CSV', () => {
  it('periodRange og shiftAnchor for år', () => {
    expect(periodRange('year', new Date(2026, 8, 25))).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(periodRange('year', shiftAnchor('year', new Date(2026, 8, 25), -1)).start).toBe('2025-01-01');
  });
  it('groupDaysByMonth giver 12 måneder for et år', () => {
    const days = daysInRange({ start: '2026-01-01', end: '2026-12-31' }).map(key => ({ key, seconds: 60 }));
    const months = groupDaysByMonth(days);
    expect(months).toHaveLength(12);
    expect(months[1]).toEqual({ key: '2026-02', seconds: 28 * 60 });
  });
  it('entriesToCsv: semikolon, decimalkomma, citering og BOM', () => {
    const data = {
      projects: [project('p1', 'c1')],
      clients: [{ id: 'c1', name: 'Acme; ApS', createdAt: '' }],
      tags: [{ id: 't1', name: 'Møde', color: '#000000', createdAt: '' }],
      entries: [
        entry('b', [at(13), at(14, 30)], { description: 'Sagde "hej"', projectId: 'p1', clientId: 'c1', tagIds: ['t1'] }),
        entry('a', [at(9), at(9, 20)]),
        entry('x', [at(9, 0, 30), at(10, 0, 30)]),
      ],
    };
    const csv = entriesToCsv(data, { start: '2026-09-24', end: '2026-09-24' });
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(lines[0]).toBe('Dato;Start;Slut;Timer;Beskrivelse;Projekt;Kunde;Tags');
    expect(lines[1]).toBe('2026-09-24;09:00;09:20;0,33;;;;');
    expect(lines[2]).toBe('2026-09-24;13:00;14:30;1,50;"Sagde ""hej""";P p1;"Acme; ApS";Møde');
    expect(lines).toHaveLength(3);
  });
});
