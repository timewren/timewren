/**
 * Kadence for "ufaktureret tid"-påmindelsen (#622).
 *
 * Cronen kører dagligt kl. 10 (UTC), og den enkelte bruger afgør selv hvor
 * ofte mailen faktisk skal sendes via `emailPreferences.unbilledReminderFrequency`:
 *
 * - `daily`   — hver hverdag (man–fre)
 * - `weekly`  — hver fredag (default)
 * - `monthly` — sidste hverdag i måneden
 *
 * Alle vurderinger sker i Europe/Copenhagen, så en kørsel sent fredag aften
 * UTC ikke tæller som fredag når den er lørdag i Danmark.
 */

import { monthBoundsCopenhagen } from "@/lib/projects/budget";

export const UNBILLED_REMINDER_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
] as const;

export type UnbilledReminderFrequency =
  (typeof UNBILLED_REMINDER_FREQUENCIES)[number];

/** Default når brugeren ikke har valgt noget (matcher schema-default). */
export const DEFAULT_UNBILLED_REMINDER_FREQUENCY: UnbilledReminderFrequency =
  "weekly";

/** Dansk label til indstillingssiden. */
export const UNBILLED_REMINDER_FREQUENCY_LABELS: Record<
  UnbilledReminderFrequency,
  string
> = {
  daily: "Hver hverdag",
  weekly: "Hver fredag",
  monthly: "Sidst på måneden",
};

/** Footer-tekst i mailen, så den matcher den valgte kadence. */
export const UNBILLED_REMINDER_FOOTER_NOTES: Record<
  UnbilledReminderFrequency,
  string
> = {
  daily: "Påmindelsen sendes hver hverdag.",
  weekly: "Påmindelsen sendes hver fredag.",
  monthly: "Påmindelsen sendes sidst på måneden.",
};

const REMINDER_TIMEZONE = "Europe/Copenhagen";

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: REMINDER_TIMEZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface ZonedDay {
  year: number;
  month: number;
  day: number;
  /** 0 = søndag … 6 = lørdag. */
  weekday: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Kalenderdagen i København for et givet tidspunkt. */
function zonedDay(date: Date): ZonedDay {
  const map: Record<string, string> = {};
  for (const part of dayFormatter.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: WEEKDAY_INDEX[map.weekday] ?? 0,
  };
}

function isWeekday(day: ZonedDay): boolean {
  return day.weekday >= 1 && day.weekday <= 5;
}

function sameDay(a: ZonedDay, b: ZonedDay): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * Sidste hverdag i den måned `now` ligger i (dansk kalender).
 * Starter midt på månedens sidste dag og går bagud, så DST-skift ikke kan
 * springe en dag over.
 */
function lastWeekdayOfMonth(now: Date): ZonedDay {
  const { next } = monthBoundsCopenhagen(now);
  let cursor = new Date(next.getTime() - DAY_MS / 2);
  let day = zonedDay(cursor);
  while (!isWeekday(day)) {
    cursor = new Date(cursor.getTime() - DAY_MS);
    day = zonedDay(cursor);
  }
  return day;
}

/** Normalisér en (muligvis ukendt) værdi fra DB til en gyldig frekvens. */
export function normalizeUnbilledReminderFrequency(
  frequency: string | null | undefined,
): UnbilledReminderFrequency {
  return UNBILLED_REMINDER_FREQUENCIES.includes(
    frequency as UnbilledReminderFrequency,
  )
    ? (frequency as UnbilledReminderFrequency)
    : DEFAULT_UNBILLED_REMINDER_FREQUENCY;
}

/**
 * Skal påmindelsen sendes i dag for en bruger med den givne frekvens?
 * Ren funktion — ingen DB, ingen `Date.now()` uden `now`.
 */
export function shouldSendUnbilledReminder(
  frequency: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const today = zonedDay(now);

  switch (normalizeUnbilledReminderFrequency(frequency)) {
    case "daily":
      return isWeekday(today);
    case "monthly":
      return sameDay(today, lastWeekdayOfMonth(now));
    default:
      // weekly
      return today.weekday === 5;
  }
}
