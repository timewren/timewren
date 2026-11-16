import { t } from "../i18n/core";
/**
 * Regler for "Rediger registrering" (kalender og historik), holdt fri af
 * React så de kan testes.
 */

export function isoToTimeStr(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Dansk timetal ("1,5") → tal; null hvis det ikke er et positivt tal. */
export function parseHoursInput(raw: string): number | null {
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface EditTimesInput {
  /** Postens dato (YYYY-MM-DD) */
  date: string;
  originalStart: string | null;
  originalEnd: string | null;
  originalHours: number;
  /** Felterne som "HH:MM" eller tom streng */
  start: string;
  end: string;
  /** Timetal-feltet (bruges når posten ikke har tidspunkter) */
  hoursInput: string;
}

export type EditTimesResult =
  | {
      ok: true;
      hours: number;
      /** Kun med, når tiderne er ændret — ellers rører serveren dem ikke */
      startTime?: string;
      endTime?: string;
    }
  | { ok: false; error: string };

/**
 * Tider sendes kun, når de er ændret: en uændret post over midnat (23:00 →
 * 01:00) må ikke afvises eller få sine tider omskrevet. Ændrede tider skal
 * have slut efter start. Uden tidspunkter er timetallet det, der rettes.
 */
export function resolveEditTimes(input: EditTimesInput): EditTimesResult {
  const origStart = isoToTimeStr(input.originalStart);
  const origEnd = isoToTimeStr(input.originalEnd);
  const timesChanged = input.start !== origStart || input.end !== origEnd;
  const hasTimes = !!input.start && !!input.end;

  if (!timesChanged) {
    if (hasTimes) return { ok: true, hours: input.originalHours };
    const hours = parseHoursInput(input.hoursInput);
    if (hours === null) {
      return { ok: false, error: t("errors.entry.hoursPositive") };
    }
    return { ok: true, hours };
  }

  if (!hasTimes) {
    if (!input.start && !input.end) {
      // Serveren kan ikke fjerne tiderne. Blev kun timetallet sendt, stod
      // posten med de gamle tider og et andet timetal (09-11 som 5 t).
      return {
        ok: false,
        error: t("errors.entry.timesCannotBeRemoved"),
      };
    }
    return { ok: false, error: t("errors.entry.fillStartEnd") };
  }

  const startMin = toMinutes(input.start);
  let endMin = toMinutes(input.end);
  // Slut 00:00 efter en start er midnat (samme regel som resolveCreateTimes)
  if (endMin === 0 && startMin > 0) endMin = 24 * 60;
  if (endMin <= startMin) {
    return { ok: false, error: t("errors.entry.endAfterStart") };
  }

  const base = new Date(`${input.date}T00:00:00`);
  const startDate = new Date(base);
  startDate.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
  const endDate = new Date(base);
  endDate.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);
  return {
    ok: true,
    hours: (endMin - startMin) / 60,
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
  };
}

export type CreateTimesResult =
  | { ok: true; startMinutes: number; endMinutes: number }
  | { ok: false; error: string };

/**
 * Start- og sluttid ved oprettelse ("HH:MM"). Slut 00:00 efter en start er
 * midnat, så en post 23:00-00:00 kan oprettes på dagen.
 */
export function resolveCreateTimes(
  start: string,
  end: string,
): CreateTimesResult {
  if (!start || !end)
    return { ok: false, error: t("errors.entry.fillStartEnd") };
  const startMinutes = toMinutes(start);
  let endMinutes = toMinutes(end);
  if (endMinutes === 0 && startMinutes > 0) endMinutes = 24 * 60;
  if (endMinutes <= startMinutes) {
    return { ok: false, error: t("errors.entry.endAfterStart") };
  }
  return { ok: true, startMinutes, endMinutes };
}
