import type { RouterOutputs } from '~/api/app-router';
import { addDays, format as dfFormat, parseISO, startOfWeek } from 'date-fns';
import { dateFnsLocale, formatWords } from '~/lib/locale';

export type WeekOverview = RouterOutputs['logbook']['weekOverview'];
export type OverviewMember = WeekOverview['members'][number];
export type DayCell = OverviewMember['days'][string];
export type DayDetail = RouterOutputs['logbook']['dayDetail']['days'][number];

/** Serverens input-krav på `weekStart` — samme regex som web's zod-skema. */
const WEEK_START_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Datoen i en `yyyy-MM-dd`-streng, kun hvis den også findes i kalenderen.
 *
 * Regex'en alene lader `2026-13-45` og `2026-02-30` slippe igennem fra et dybt
 * link, og `date-fns` kaster `RangeError: Invalid time value` på dem — under
 * render, uden for `ErrorState`s greb. Derfor er gyldigheden her, ikke kun
 * ved kaldstederne.
 */
function parseDay(value: string): Date | null {
  if (!WEEK_START_RE.test(value))
    return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Sand kun for en hel gyldig `yyyy-MM-dd`, så et råt query-param ikke slipper igennem. */
export function isWeekStart(value: unknown): value is string {
  return typeof value === 'string' && parseDay(value) !== null;
}

/** `dayDetail`-intervallet med de felter skærmen bruger. */
export type Interval = DayDetail['intervals'][number];
export type Gap = DayDetail['gapDetails'][number];

/**
 * Mandagen i den uge `offset` uger fra `now`. Offset 0 = denne uge, -1 =
 * forrige uge. `yyyy-MM-dd`, som serverens input-krav.
 */
export function weekStartAt(offset: number, now: Date = new Date()): string {
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  return dfFormat(addDays(monday, offset * 7), 'yyyy-MM-dd');
}

/** Kan brugeren blive længere frem end denne uge? Logbogen er historisk. */
export function canGoForward(offset: number): boolean {
  return offset < 0;
}

/**
 * De syv dage i ugen som `yyyy-MM-dd`, fra mandag. En dato, der ikke findes,
 * falder tilbage på den aktuelle uge — præcis som et dybt link uden
 * `weekStart` gør, så skærmen viser noget gyldigt i stedet for at hvidblænde.
 */
export function weekDates(weekStart: string): string[] {
  const start = parseDay(weekStart) ?? startOfWeek(new Date(), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => dfFormat(addDays(start, i), 'yyyy-MM-dd'));
}

/** "Man", "Tir" … Ugedagsnavnet følger kalenderen, ikke kolonnens rækkefølge. */
export function dayShort(date: string): string {
  const day = parseDay(date);
  if (!day)
    return '—';
  const text = dfFormat(day, 'EEEE', { locale: dateFnsLocale() });
  return text.charAt(0).toUpperCase() + text.slice(1, 3);
}

/**
 * "08:00 – 16:30" — eller `null` når dagen ikke har begge tidspunkter.
 *
 * Uden begge dele må vi ikke påstå præcise komme/gå-tider, så cellen viser
 * kun den registrerede varighed.
 */
export function clockRange(cell: DayCell | undefined): string | null {
  if (!cell?.firstStart || !cell.lastEnd)
    return null;
  const from = dfFormat(new Date(cell.firstStart), 'HH:mm');
  const to = dfFormat(new Date(cell.lastEnd), 'HH:mm');
  return `${from} – ${to}`;
}

/**
 * Sand når alle dagens registreringer havde tidspunkter. Ellers står
 * varigheder blandt i cellen, og "første start/sidste slut" er kun sandt for
 * den tidsstemplede del — samme ærlighedsregel som web's logbog.
 */
export function hasPreciseTimes(cell: DayCell | undefined): boolean {
  return !!cell && cell.entriesCount > 0 && cell.timedCount === cell.entriesCount;
}

/** Registrerede timer i ugen for ét medlem, summeret som serveren gør: 2 decimaler. */
export function memberHours(member: OverviewMember): number {
  const total = Object.values(member.days).reduce((sum, d) => sum + (Number.isFinite(d.totalHours) ? d.totalHours : 0), 0);
  return Math.round(total * 100) / 100;
}

/** Dage i ugen med mindst én registrering, i kalenderorden. */
export function activeDates(member: OverviewMember, weekStart: string): string[] {
  return weekDates(weekStart).filter(date => (member.days[date]?.entriesCount ?? 0) > 0);
}

/**
 * Mellemrum mellem to intervaller i minutter. `null` når vi ikke kender
 * begge sider — et hul uden start eller slut kan ikke måles.
 */
export function gapMinutes(before: Interval | undefined, after: Interval | undefined): number | null {
  const from = after?.start;
  const to = before?.end;
  if (!from || !to)
    return null;
  const minutes = Math.round((new Date(from).getTime() - new Date(to).getTime()) / 60_000);
  return minutes > 0 ? minutes : 0;
}

/** 95 minutter → "1 t 35 min." — kort nok til en liste på en telefon. */
export function formatGap(minutes: number): string {
  const safe = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0)
    return `${m} min.`;
  return m === 0 ? `${h} ${formatWords().hourUnit}` : `${h} ${formatWords().hourUnit} ${m} min.`;
}

/**
 * Sand når dagen overhovedet har tidsstemplede intervaller. Uden dem kan
 * hverken pauser eller komme/gå-tider beregnes, og skærmen skal sige det
 * ærligt i stedet for at vise et tomt forløb.
 */
export function hasTimeline(day: DayDetail): boolean {
  return day.intervals.some(i => i.start !== null && i.end !== null);
}

/** Dagens pauser i rækkefølge med det interval der følger ved, til overskrift. */
export function gapLabels(day: DayDetail): { minutes: number; label: string }[] {
  return day.gapDetails.map((gap) => {
    const after = day.intervals[gap.afterIndex];
    const before = day.intervals[gap.beforeIndex];
    const name = [after?.projectName ?? after?.clientName, before?.projectName ?? before?.clientName]
      .filter(Boolean)
      .join(' → ');
    return { minutes: gap.minutes, label: name || '—' };
  });
}
