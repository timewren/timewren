import type { StatTone } from '~/components/ui/stat-tile';
import type { TxKeyPath } from '~/lib/i18n';
import { addDays, addWeeks, endOfDay, isValid, parse, startOfDay } from 'date-fns';
import { formatWords, intlLocale } from '~/lib/locale';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskLegacyStatus = 'backlog' | 'todo' | 'in_progress' | 'done';
export type TaskSegment = 'today' | 'open' | 'overdue' | 'done';

export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
export const TASK_SEGMENTS: readonly TaskSegment[] = ['today', 'open', 'overdue', 'done'];

export function priorityTone(priority: string | null | undefined): StatTone {
  switch (priority) {
    case 'urgent': return 'danger';
    case 'high': return 'warning';
    case 'medium': return 'primary';
    default: return 'default';
  }
}

export function priorityTx(priority: string | null | undefined): TxKeyPath {
  const p = (TASK_PRIORITIES as readonly string[]).includes(priority ?? '') ? priority : 'medium';
  return `tasks.priority.${p as TaskPriority}`;
}

export type TaskLike = {
  status: string;
  deadline: Date | string | null;
  completedAt?: Date | string | null;
};

export function isDone(task: TaskLike): boolean {
  return task.status === 'done';
}

export function isOverdue(task: TaskLike, now = new Date()): boolean {
  if (isDone(task) || !task.deadline)
    return false;
  return new Date(task.deadline) < now;
}

export function isDueToday(task: TaskLike, now = new Date()): boolean {
  if (!task.deadline)
    return false;
  const d = new Date(task.deadline);
  return d >= startOfDay(now) && d <= endOfDay(now);
}

/** Tone på deadline-chip: forfalden = danger, i dag = warning, ellers neutral. */
export function deadlineTone(task: TaskLike, now = new Date()): StatTone {
  if (isOverdue(task, now))
    return 'danger';
  if (isDueToday(task, now))
    return 'warning';
  return 'default';
}

/** Segment-filter på en fuld opgaveliste (bruges for alle segmenter undtagen "I dag", der kommer fra getTodaysFocus). */
export function filterTasks<T extends TaskLike>(tasks: T[], segment: Exclude<TaskSegment, 'today'>, now = new Date()): T[] {
  switch (segment) {
    case 'open': return tasks.filter(t => !isDone(t));
    case 'overdue': return tasks.filter(t => isOverdue(t, now));
    case 'done': return tasks.filter(t => isDone(t));
  }
}

/** Sortér åbne opgaver: deadline først (nærmest øverst), uden deadline til sidst. */
export function sortByDeadline<T extends TaskLike>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (!a.deadline && !b.deadline)
      return 0;
    if (!a.deadline)
      return 1;
    if (!b.deadline)
      return -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });
}

/** 90 → "1,5 t"; null → "–" */
export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes)
    return '–';
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours.toLocaleString(intlLocale(), { maximumFractionDigits: 2 })} ${formatWords().hourUnit}`;
}

/** "1,5" / "1.5" / "2" → minutter; tom eller ugyldig → null */
export function parseHoursToMinutes(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!normalized)
    return null;
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n) || n <= 0)
    return null;
  return Math.round(n * 60);
}

/** "2026-09-06" → Date (lokal, kl. 12 så tidszoner ikke flytter dagen); ugyldig → null */
export function parseISODateInput(text: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed)
    return null;
  const d = parse(trimmed, 'yyyy-MM-dd', new Date());
  if (!isValid(d))
    return null;
  d.setHours(12, 0, 0, 0);
  return d;
}

export type DateChip = 'today' | 'tomorrow' | 'next_week';

export function dateForChip(chip: DateChip, now = new Date()): Date {
  const base = startOfDay(now);
  base.setHours(12);
  switch (chip) {
    case 'today': return base;
    case 'tomorrow': return addDays(base, 1);
    case 'next_week': return addWeeks(base, 1);
  }
}

const TAG_RE = /<[^>]*>/g;
const ENTITY_MAP: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&nbsp;': ' ' };
const ENTITY_RE = /&(?:amp|lt|gt|quot|#39|nbsp);/g;
const BR_RE = /<br\s*\/?>|<\/p>/gi;

/** Kommentar-HTML fra web (tiptap) → ren tekst til mobil-visning. */
export function stripHtml(html: string): string {
  return html
    .replace(BR_RE, '\n')
    .replace(TAG_RE, '')
    .replace(ENTITY_RE, m => ENTITY_MAP[m] ?? m)
    .trim();
}

const AMP_RE = /&/g;
const LT_RE = /</g;
const GT_RE = />/g;
const QUOT_RE = /"/g;
const NEWLINES_RE = /\n+/;

function escapeHtml(text: string): string {
  return text
    .replace(AMP_RE, '&amp;')
    .replace(LT_RE, '&lt;')
    .replace(GT_RE, '&gt;')
    .replace(QUOT_RE, '&quot;');
}

/** Ren tekst → det tiptap-dokument + HTML som `taskComments.create` forventer. */
export function plainTextToComment(text: string): { content: Record<string, unknown>; contentHtml: string } {
  const paragraphs = text.trim().split(NEWLINES_RE).filter(Boolean);
  return {
    content: {
      type: 'doc',
      content: paragraphs.map(p => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
    },
    contentHtml: paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join(''),
  };
}

/** Find den lane der svarer til opgavens status: statusId først, ellers legacy-navn. */
export function resolveLaneId(task: { statusId: string | null; status: string }, lanes: { id: string; name: string }[]): string | undefined {
  if (task.statusId && lanes.some(l => l.id === task.statusId))
    return task.statusId;
  const legacyName = LEGACY_LANE_NAMES[task.status as TaskLegacyStatus];
  return lanes.find(l => l.name === legacyName)?.id;
}

const LEGACY_LANE_NAMES: Record<TaskLegacyStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'I gang',
  done: 'Afsluttet',
};
