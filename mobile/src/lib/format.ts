import {
  format as dfFormat,
  formatDistanceToNowStrict,
  isThisYear,
  isToday,
  isYesterday,
} from 'date-fns';
import { dateFnsLocale, formatWords, hourUnit, intlLocale } from '~/lib/locale';

/** 7.5 → "7,5 t"; 0.25 → "0,25 t"; 8 → "8 t" */
export function formatHours(hours: number | string | null | undefined, opts: { unit?: boolean } = {}): string {
  const n = typeof hours === 'string' ? Number.parseFloat(hours) : (hours ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const rounded = Math.round(safe * 100) / 100;
  const text = rounded.toLocaleString(intlLocale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return opts.unit === false ? text : `${text} ${hourUnit()}`;
}

/** 7.5 → "7:30" */
export function formatHoursClock(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/** Sekunder → "01:23:45" (timer-visning). */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(v => v.toString().padStart(2, '0')).join(':');
}

/** 1234.5 → "1.234,50 kr." */
export function formatMoney(amount: number | string | null | undefined, opts: { decimals?: number } = {}): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : (amount ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const decimals = opts.decimals ?? (Number.isInteger(safe) ? 0 : 2);
  return `${safe.toLocaleString(intlLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} kr.`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)} %`;
}

function toDate(d: Date | string | number): Date {
  return d instanceof Date ? d : new Date(d);
}

/**
 * Vi viser hellere en tankestreg end en hvid skærm. `date-fns` kaster
 * `RangeError: Invalid time value` på en `Invalid Date`, og en skærm der
 * formatterer et råt query-param eller en manglende serverdato ville så dø under
 * render — uden for enhver `ErrorState`.
 */
const NO_DATE = '—';

function readable(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

/** "6. sep." / "6. sep. 2025" (andet år) */
export function formatDateShort(d: Date | string | number): string {
  const date = toDate(d);
  if (!readable(date))
    return NO_DATE;
  return dfFormat(date, isThisYear(date) ? 'd. MMM' : 'd. MMM yyyy', { locale: dateFnsLocale() });
}

/** "Lørdag 6. september" */
export function formatDateLong(d: Date | string | number): string {
  const date = toDate(d);
  if (!readable(date))
    return NO_DATE;
  const text = dfFormat(date, 'EEEE d. MMMM', { locale: dateFnsLocale() });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "I dag" / "I går" / "6. sep." */
export function formatDateRelative(d: Date | string | number): string {
  const date = toDate(d);
  if (isToday(date))
    return formatWords().today;
  if (isYesterday(date))
    return formatWords().yesterday;
  return formatDateShort(date);
}

/** "14:05" */
export function formatTime(d: Date | string | number): string {
  const date = toDate(d);
  return readable(date) ? dfFormat(date, 'HH:mm', { locale: dateFnsLocale() }) : NO_DATE;
}

/** "for 3 minutter siden" */
export function formatAgo(d: Date | string | number): string {
  const date = toDate(d);
  if (!readable(date))
    return NO_DATE;
  return formatWords().ago(formatDistanceToNowStrict(date, { locale: dateFnsLocale() }));
}

/** yyyy-MM-dd (backendens datoformat for dagsposter) */
export function toISODate(d: Date | string | number): string {
  return dfFormat(toDate(d), 'yyyy-MM-dd');
}

const COPENHAGEN_DATE = (() => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  catch {
    return null;
  }
})();

/**
 * yyyy-MM-dd for den DANSKE kalenderdag — uanset telefonens tidszone.
 *
 * Web, uger og rapporter tæller dagen i Europe/Copenhagen. En dansk bruger på
 * rejse (fx New York kl. 20 = 02 dansk tid næste dag) ville ellers få posten
 * på den forkerte dag. Uden Intl-tidszoner falder vi tilbage til enhedens dag.
 */
export function toCopenhagenISODate(d: Date | string | number): string {
  const date = toDate(d);
  if (!COPENHAGEN_DATE || !readable(date))
    return toISODate(date);
  const parts = COPENHAGEN_DATE.formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return year && month && day ? `${year}-${month}-${day}` : toISODate(date);
}

/** Uge 36 */
export function formatWeek(d: Date | string | number): string {
  const date = toDate(d);
  return readable(date) ? `${formatWords().week} ${dfFormat(date, 'I', { locale: dateFnsLocale() })}` : NO_DATE;
}

const WHITESPACE_RE = /\s+/;

/** Initialer til avatar: "Mads Holst Jensen" → "MJ" */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(WHITESPACE_RE).filter(Boolean);
  if (parts.length === 0)
    return '?';
  if (parts.length === 1)
    return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts.at(-1)![0]!).toUpperCase();
}
