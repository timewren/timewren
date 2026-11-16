import type { StatTone } from '~/components/ui/stat-tile';
import { formatDateShort } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { prepaidDaysUntilExpiry, prepaidExpiryDisplayDate } from '~/lib/prepaid-expiry';

export type PrepaidLike = {
  totalHours: string | number;
  remainingHours: string | number;
  expiryDate: Date | string | null;
  isActive?: boolean | null;
  isArchived?: boolean | null;
};

export type PrepaidStatus = {
  totalHours: number;
  remainingHours: number;
  usedHours: number;
  /** 0–1 andel tilbage */
  fraction: number;
  daysUntilExpiry: number | null;
  isExpired: boolean;
  /** Udløber inden for 30 dage (i dag medregnet) */
  isExpiringSoon: boolean;
  /** ≤ 20 % tilbage (som web) */
  isLowBalance: boolean;
  isDepleted: boolean;
  expiryTone: StatTone;
  balanceTone: StatTone;
};

export type PrepaidSegment = 'active' | 'expired' | 'archived';

function num(v: string | number | null | undefined): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : (v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Hele dage til udløb i dansk tid: 0 = udløber i dag, negativ = udløbet.
 * null uden udløbsdato. Kortet gælder hele udløbsdagen (som web, #738).
 */
export function daysUntil(expiry: Date | string | null | undefined, now: Date = new Date()): number | null {
  return prepaidDaysUntilExpiry(expiry, now);
}

/** Badge-tone for udløb: udløbet = danger, < 30 dage (i dag medregnet) = warning, ellers default. */
export function expiryTone(days: number | null): StatTone {
  if (days === null)
    return 'default';
  if (days < 0)
    return 'danger';
  if (days < 30)
    return 'warning';
  return 'default';
}

export function prepaidStatus(pkg: PrepaidLike, now: Date = new Date()): PrepaidStatus {
  const totalHours = num(pkg.totalHours);
  const remainingHours = num(pkg.remainingHours);
  const fraction = totalHours > 0 ? Math.min(1, Math.max(0, remainingHours / totalHours)) : 0;
  const days = daysUntil(pkg.expiryDate, now);
  const isExpired = days !== null && days < 0;
  const isDepleted = remainingHours <= 0;
  const isLowBalance = !isDepleted && remainingHours <= totalHours * 0.2;
  const balanceTone: StatTone = isDepleted ? 'danger' : isLowBalance ? 'warning' : 'violet';
  return {
    totalHours,
    remainingHours,
    usedHours: Math.max(0, totalHours - remainingHours),
    fraction,
    daysUntilExpiry: days,
    isExpired,
    isExpiringSoon: days !== null && days >= 0 && days < 30,
    isLowBalance,
    isDepleted,
    expiryTone: expiryTone(days),
    balanceTone,
  };
}

/**
 * Udløb som én tekst, delt mellem badge'en på kortet og labelen til
 * skærmlæseren. Ét sted at ændre, så de to aldrig kan komme i utakt.
 */
export function expiryText(pkg: PrepaidLike, now: Date = new Date()): string | null {
  const expiry = pkg.expiryDate;
  const days = daysUntil(expiry, now);
  if (!expiry || days === null)
    return null;
  if (days < 0)
    return translate('prepaid.expired_badge');
  if (days === 0)
    return translate('prepaid.expires_today');
  if (days === 1)
    return translate('prepaid.expires_tomorrow');
  if (days < 30)
    return translate('prepaid.days_left', { days });
  // Dansk kalenderdato, så telefonens tidszone ikke flytter datoen en dag.
  const displayDate = prepaidExpiryDisplayDate(expiry);
  return displayDate ? translate('prepaid.expires', { date: formatDateShort(displayDate) }) : null;
}

/** Hvilket segment et kort hører til i listen. */
export function prepaidSegment(pkg: PrepaidLike, now: Date = new Date()): PrepaidSegment {
  if (pkg.isArchived)
    return 'archived';
  const days = daysUntil(pkg.expiryDate, now);
  if ((days !== null && days < 0) || pkg.isActive === false)
    return 'expired';
  return 'active';
}

/** Sortér efter saldo: laveste andel først (dem der kræver opmærksomhed). */
export function sortByBalance<T extends PrepaidLike>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const fa = prepaidStatus(a).fraction;
    const fb = prepaidStatus(b).fraction;
    if (fa !== fb)
      return fa - fb;
    return num(a.remainingHours) - num(b.remainingHours);
  });
}

/** Standard-udløb: i dag + n måneder som yyyy-MM-dd. */
export function addMonthsISO(months: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() + months, from.getDate());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: string): boolean {
  if (!ISO_DATE_RE.test(value))
    return false;
  const d = new Date(`${value}T00:00:00`);
  return !Number.isNaN(d.getTime());
}

/** "7,5" / "7.5" → 7.5; ugyldigt → null */
export function parseDecimal(value: string): number | null {
  const cleaned = value.trim().replace(',', '.');
  if (cleaned === '')
    return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
