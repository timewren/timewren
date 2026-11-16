import {
  dateForChip,
  deadlineTone,
  filterTasks,
  formatMinutes,
  isOverdue,
  parseHoursToMinutes,
  parseISODateInput,
  plainTextToComment,
  priorityTone,
  resolveLaneId,
  sortByDeadline,
  stripHtml,
} from './task-logic';

const NOW = new Date(2026, 8, 6, 12);

const open = { id: '1', status: 'todo', deadline: new Date(2026, 8, 10) };
const overdue = { id: '2', status: 'in_progress', deadline: new Date(2026, 8, 1) };
const today = { id: '3', status: 'todo', deadline: new Date(2026, 8, 6, 17) };
const done = { id: '4', status: 'done', deadline: new Date(2026, 8, 1) };
const noDeadline = { id: '5', status: 'backlog', deadline: null };

describe('task-logic', () => {
  it('prioritet → tone', () => {
    expect(priorityTone('urgent')).toBe('danger');
    expect(priorityTone('high')).toBe('warning');
    expect(priorityTone('medium')).toBe('primary');
    expect(priorityTone('low')).toBe('default');
    expect(priorityTone(null)).toBe('default');
  });

  it('forfalden kun når åben og deadline passeret', () => {
    expect(isOverdue(overdue, NOW)).toBe(true);
    expect(isOverdue(done, NOW)).toBe(false);
    expect(isOverdue(noDeadline, NOW)).toBe(false);
    expect(deadlineTone(overdue, NOW)).toBe('danger');
    expect(deadlineTone(today, NOW)).toBe('warning');
    expect(deadlineTone(open, NOW)).toBe('default');
  });

  it('segment-filter', () => {
    const all = [open, overdue, today, done, noDeadline];
    expect(filterTasks(all, 'open', NOW).map(t => t.id)).toEqual(['1', '2', '3', '5']);
    expect(filterTasks(all, 'overdue', NOW).map(t => t.id)).toEqual(['2']);
    expect(filterTasks(all, 'done', NOW).map(t => t.id)).toEqual(['4']);
  });

  it('sortByDeadline lægger opgaver uden deadline sidst', () => {
    expect(sortByDeadline([noDeadline, open, overdue]).map(t => t.id)).toEqual(['2', '1', '5']);
  });

  it('minutter ↔ timer', () => {
    expect(formatMinutes(90)).toBe('1,5 t');
    expect(formatMinutes(null)).toBe('–');
    expect(parseHoursToMinutes('1,5')).toBe(90);
    expect(parseHoursToMinutes('2')).toBe(120);
    expect(parseHoursToMinutes('')).toBeNull();
    expect(parseHoursToMinutes('abc')).toBeNull();
  });

  it('datoinput og chips', () => {
    const d = parseISODateInput('2026-09-10');
    expect(d?.getDate()).toBe(10);
    expect(d?.getHours()).toBe(12);
    expect(parseISODateInput('10/9')).toBeNull();
    expect(parseISODateInput('')).toBeNull();
    expect(dateForChip('tomorrow', NOW).getDate()).toBe(7);
    expect(dateForChip('next_week', NOW).getDate()).toBe(13);
  });

  it('kommentar-html ↔ ren tekst', () => {
    expect(stripHtml('<p>Hej <strong>verden</strong> &amp; co</p><p>linje 2</p>')).toBe('Hej verden & co\nlinje 2');
    const c = plainTextToComment('Første\n\n<b>anden</b>');
    expect(c.contentHtml).toBe('<p>Første</p><p>&lt;b&gt;anden&lt;/b&gt;</p>');
    expect(c.content).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Første' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '<b>anden</b>' }] },
      ],
    });
  });

  it('resolveLaneId: statusId først, ellers legacy-navn', () => {
    const lanes = [{ id: 'l1', name: 'Backlog' }, { id: 'l2', name: 'I gang' }];
    expect(resolveLaneId({ statusId: 'l2', status: 'backlog' }, lanes)).toBe('l2');
    expect(resolveLaneId({ statusId: 'gone', status: 'in_progress' }, lanes)).toBe('l2');
    expect(resolveLaneId({ statusId: null, status: 'done' }, lanes)).toBeUndefined();
  });
});
