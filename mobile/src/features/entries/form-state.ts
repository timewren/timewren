import type { RouterInputs, RouterOutputs } from '~/api/app-router';
import { toISODate } from '~/lib/format';
import { clockFromDate, formatHoursInput, hoursBetween, parseHoursInput, rangeToISO } from './duration';
import { entryDateKey } from './period';

export type TimeMode = 'duration' | 'range';

type TimeEntryDetail = RouterOutputs['time']['getById'];

export type EntryFormState = {
  clientId: string | null;
  projectId: string | null;
  taskId: string | null;
  /** yyyy-MM-dd */
  date: string;
  timeMode: TimeMode;
  /** Tal-feltet ("1,5", "1:30", "90m") */
  hoursText: string;
  startText: string;
  endText: string;
  description: string;
  notes: string;
  isBillable: boolean;
  prepaidPackageId: string | null;
  /**
   * Manuelt valgte tags. Nedarvede (fra kunde/projekt) er **ikke** her: dem
   * sætter serveren, og `tags.setForEntry` sletter dem aldrig, så en bruger
   * ikke kan fjerne dem her — de vises som låste chips i stedet.
   */
  tagIds: string[];
};

export type FormErrorKey
  = | 'entries.errors.description_required'
    | 'entries.errors.hours_invalid'
    | 'entries.errors.hours_min'
    | 'entries.errors.range_invalid'
    | 'entries.errors.date_invalid';

export type CreatePayload = RouterInputs['time']['create'];
export type UpdateData = RouterInputs['time']['update']['data'];

export type BuildResult
  = | { ok: true; payload: CreatePayload }
    | { ok: false; error: FormErrorKey; field: 'description' | 'hours' | 'range' | 'date' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIGITS_RE = /^\d{3,4}$/;

/** "0900" → "09:00", "900" → "9:00"; alt andet uændret. */
export function normalizeClock(text: string): string {
  const t = text.trim();
  if (DIGITS_RE.test(t))
    return `${t.slice(0, -2)}:${t.slice(-2)}`;
  return t;
}

/** Timer der gemmes: fra tal-feltet eller udledt af start/slut. */
export function effectiveHours(state: EntryFormState): number | null {
  if (state.timeMode === 'range')
    return hoursBetween(normalizeClock(state.startText), normalizeClock(state.endText));
  return parseHoursInput(state.hoursText);
}

/**
 * Validerer som backendens zod-schema (beskrivelse 1-500, timer ≥ 0.01,
 * slut efter start) og bygger `time.create`-input. Bruges også til update
 * (`data` har samme felter; prepaid håndteres af kalderen).
 */
export function buildPayload(state: EntryFormState, opts: { klippekort: boolean }): BuildResult {
  const description = state.description.trim();
  if (description.length === 0)
    return { ok: false, error: 'entries.errors.description_required', field: 'description' };
  if (!DATE_RE.test(state.date))
    return { ok: false, error: 'entries.errors.date_invalid', field: 'date' };

  let hours: number | null;
  let range: { startTime: string; endTime: string } | undefined;
  if (state.timeMode === 'range') {
    const built = rangeToISO(state.date, normalizeClock(state.startText), normalizeClock(state.endText));
    if (!built)
      return { ok: false, error: 'entries.errors.range_invalid', field: 'range' };
    range = built;
    hours = hoursBetween(normalizeClock(state.startText), normalizeClock(state.endText));
  }
  else {
    hours = parseHoursInput(state.hoursText);
    if (hours === null)
      return { ok: false, error: 'entries.errors.hours_invalid', field: 'hours' };
  }
  if (hours === null || hours < 0.01)
    return { ok: false, error: 'entries.errors.hours_min', field: 'hours' };

  const payload: CreatePayload = {
    description: description.slice(0, 500),
    hours,
    date: state.date,
    isBillable: state.isBillable,
    projectId: state.projectId ?? undefined,
    // Som web: kunden sidder på projektet når et projekt er valgt
    clientId: state.projectId ? undefined : (state.clientId ?? undefined),
    taskId: state.taskId ?? undefined,
    notes: state.notes.trim() ? state.notes.trim().slice(0, 5000) : undefined,
    startTime: range?.startTime,
    endTime: range?.endTime,
    prepaidPackageId: opts.klippekort && state.prepaidPackageId ? state.prepaidPackageId : undefined,
  };
  return { ok: true, payload };
}

/** Til `time.update`: som create, men null fjerner et klippekort-træk (undefined = uændret). */
export function toUpdateData(payload: CreatePayload, state: EntryFormState, klippekort: boolean): UpdateData {
  const { prepaidPackageId: _ignored, prepaidHoursOverride: _ignored2, ...rest } = payload;
  return {
    ...rest,
    prepaidPackageId: klippekort ? (state.prepaidPackageId ?? null) : undefined,
  };
}

/** Start-state til ny registrering (evt. med dato fra Hjem/Tid-fanen). */
export function initialFormState(date?: string): EntryFormState {
  return {
    clientId: null,
    projectId: null,
    taskId: null,
    date: date && date.length === 10 ? date : toISODate(new Date()),
    timeMode: 'duration',
    hoursText: '',
    startText: '',
    endText: '',
    description: '',
    notes: '',
    isBillable: true,
    prepaidPackageId: null,
    tagIds: [],
  };
}

/** Manuelt valgte tag-id'er — de nedarvede er låst og hører ikke med. */
export function manualTagIds(entry: TimeEntryDetail): string[] {
  return entry.tags.filter(t => !t.inherited).map(t => t.id);
}

/** Tænd/sluk ét tag. Ren, så den kan dømmes uden React. */
export function toggleTag(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
}

/** Samme mængde i samme rækkefølge — bruges til at springe over et kald, intet ændrede sig. */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** State fra en eksisterende post (redigér). */
export function formStateFromEntry(entry: TimeEntryDetail): EntryFormState {
  const hasRange = !!entry.startTime && !!entry.endTime;
  return {
    clientId: entry.clientId ?? entry.project?.clientId ?? null,
    projectId: entry.projectId ?? null,
    taskId: entry.taskId ?? null,
    date: entryDateKey(entry.date),
    timeMode: hasRange ? 'range' : 'duration',
    hoursText: formatHoursInput(Number.parseFloat(entry.hours)),
    startText: clockFromDate(entry.startTime),
    endText: clockFromDate(entry.endTime),
    description: entry.description ?? '',
    notes: entry.notes ?? '',
    isBillable: entry.isBillable !== false,
    prepaidPackageId: entry.prepaidPackageId ?? null,
    tagIds: manualTagIds(entry),
  };
}
