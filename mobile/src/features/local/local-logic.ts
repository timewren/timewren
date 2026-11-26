import { format } from 'date-fns';
import { intlLocale } from '~/lib/locale';

/**
 * "Uden konto"-tilstand: simpel tidsregistrering der kun lever på enheden.
 * Alt her er rene funktioner — store og skærme kalder dem, tests dækker dem.
 * Data kan senere overføres til en konto (se `toTimeCreateInput`).
 */

export type LocalClient = { id: string; name: string; createdAt: string };
export type LocalProject = { id: string; name: string; clientId: string | null; createdAt: string };
export type LocalTag = { id: string; name: string; color: string; createdAt: string };

export type LocalSelection = {
  description: string;
  projectId: string | null;
  clientId: string | null;
  tagIds: string[];
};

export type LocalEntry = LocalSelection & {
  id: string;
  /** ISO-tidspunkter — varighed udledes altid af dem. */
  startedAt: string;
  endedAt: string;
  createdAt: string;
};

export type LocalTimer = LocalSelection & { startedAt: string };

export type LocalData = {
  clients: LocalClient[];
  projects: LocalProject[];
  tags: LocalTag[];
  entries: LocalEntry[];
  timer: LocalTimer | null;
};

export const EMPTY_LOCAL_DATA: LocalData = { clients: [], projects: [], tags: [], entries: [], timer: null };
export const EMPTY_SELECTION: LocalSelection = { description: '', projectId: null, clientId: null, tagIds: [] };

/** Timer under ét minut gemmes ikke — typisk et fejltryk. */
export const MIN_ENTRY_SECONDS = 60;

/** Farver til tags (samme hex-format som web kræver: #rrggbb). */
export const TAG_COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#4b5563'] as const;

// Web's zod-grænser, så overførsel til en konto aldrig afvises.
const NAME_LIMITS = { client: [2, 255], project: [2, 255], tag: [1, 50] } as const;
export type NamedKind = keyof typeof NAME_LIMITS;
export type NameError = 'too_short' | 'too_long' | 'duplicate';

export function validateName(kind: NamedKind, name: string, existing: readonly { name: string }[]): NameError | null {
  const trimmed = name.trim();
  const [min, max] = NAME_LIMITS[kind];
  if (trimmed.length < min)
    return 'too_short';
  if (trimmed.length > max)
    return 'too_long';
  const lower = trimmed.toLocaleLowerCase(intlLocale());
  if (existing.some(e => e.name.trim().toLocaleLowerCase(intlLocale()) === lower))
    return 'duplicate';
  return null;
}

export function entrySeconds(e: { startedAt: string; endedAt: string }): number {
  return Math.max(0, (Date.parse(e.endedAt) - Date.parse(e.startedAt)) / 1000);
}

export function entryHours(e: { startedAt: string; endedAt: string }): number {
  return entrySeconds(e) / 3600;
}

/** Stop timeren → færdig post, eller null hvis den kørte under et minut. */
export function stopTimer(timer: LocalTimer, now: Date, id: string): LocalEntry | null {
  const endedAt = now.toISOString();
  if (entrySeconds({ startedAt: timer.startedAt, endedAt }) < MIN_ENTRY_SECONDS)
    return null;
  return {
    id,
    description: timer.description.trim(),
    projectId: timer.projectId,
    clientId: timer.clientId,
    tagIds: [...timer.tagIds],
    startedAt: timer.startedAt,
    endedAt,
    createdAt: endedAt,
  };
}

/** Vælges et projekt, følger dets kunde med; vælges en anden kunde, slippes projektet. */
export function applyProject(sel: LocalSelection, project: LocalProject | null): LocalSelection {
  if (!project)
    return { ...sel, projectId: null };
  return { ...sel, projectId: project.id, clientId: project.clientId ?? sel.clientId };
}

export function applyClient(sel: LocalSelection, clientId: string | null, projects: readonly LocalProject[]): LocalSelection {
  const project = projects.find(p => p.id === sel.projectId);
  const keepProject = project && (project.clientId === null || project.clientId === clientId);
  return { ...sel, clientId, projectId: keepProject ? sel.projectId : null };
}

export function toggleTag(sel: LocalSelection, tagId: string): LocalSelection {
  const has = sel.tagIds.includes(tagId);
  return { ...sel, tagIds: has ? sel.tagIds.filter(t => t !== tagId) : [...sel.tagIds, tagId] };
}

/** "Projekt · Kunde" — eller null når intet er valgt. */
export function selectionLabel(data: Pick<LocalData, 'clients' | 'projects'>, sel: Pick<LocalSelection, 'projectId' | 'clientId'>): string | null {
  const project = data.projects.find(p => p.id === sel.projectId);
  const client = data.clients.find(c => c.id === sel.clientId);
  const parts = [project?.name, client?.name].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function detach<T extends LocalSelection>(item: T, key: 'projectId' | 'clientId', id: string): T {
  return item[key] === id ? { ...item, [key]: null } : item;
}

/** Slet kunde: projekter bliver kundeløse, poster og timer mister koblingen — ingen tid går tabt. */
export function removeClient(data: LocalData, id: string): LocalData {
  return {
    ...data,
    clients: data.clients.filter(c => c.id !== id),
    projects: data.projects.map(p => (p.clientId === id ? { ...p, clientId: null } : p)),
    entries: data.entries.map(e => detach(e, 'clientId', id)),
    timer: data.timer ? detach(data.timer, 'clientId', id) : null,
  };
}

export function removeProject(data: LocalData, id: string): LocalData {
  return {
    ...data,
    projects: data.projects.filter(p => p.id !== id),
    entries: data.entries.map(e => detach(e, 'projectId', id)),
    timer: data.timer ? detach(data.timer, 'projectId', id) : null,
  };
}

export function removeTag(data: LocalData, id: string): LocalData {
  const strip = <T extends LocalSelection>(x: T): T =>
    x.tagIds.includes(id) ? { ...x, tagIds: x.tagIds.filter(t => t !== id) } : x;
  return {
    ...data,
    tags: data.tags.filter(t => t.id !== id),
    entries: data.entries.map(strip),
    timer: data.timer ? strip(data.timer) : null,
  };
}

export type DayGroup = { key: string; date: Date; seconds: number; entries: LocalEntry[] };

/** Poster grupperet pr. lokal kalenderdag (startdato), nyeste dag og post først. */
export function groupByDay(entries: readonly LocalEntry[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  const sorted = [...entries].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  for (const e of sorted) {
    const start = new Date(e.startedAt);
    const key = format(start, 'yyyy-MM-dd');
    const group = map.get(key) ?? { key, date: new Date(start.getFullYear(), start.getMonth(), start.getDate()), seconds: 0, entries: [] };
    group.seconds += entrySeconds(e);
    group.entries.push(e);
    map.set(key, group);
  }
  return [...map.values()];
}

/** Sekunder registreret på `day` (lokal dato), eksklusive en kørende timer. */
export function secondsOnDay(entries: readonly LocalEntry[], day: Date): number {
  const key = format(day, 'yyyy-MM-dd');
  return entries
    .filter(e => format(new Date(e.startedAt), 'yyyy-MM-dd') === key)
    .reduce((acc, e) => acc + entrySeconds(e), 0);
}

const CLOCK_HOURS = /^\d{1,2}$/;
const CLOCK_DIGITS = /^\d{3,4}$/;
const CLOCK_COLON = /^\d{1,2}:\d{2}$/;

/**
 * "8", "830", "8:30", "8.30", "08.30" → minutter efter midnat. Null ved ugyldigt.
 */
export function parseClock(input: string): number | null {
  const s = input.trim().replace('.', ':');
  let h: number;
  let m: number;
  if (CLOCK_HOURS.test(s)) {
    h = Number(s);
    m = 0;
  }
  else if (CLOCK_DIGITS.test(s)) {
    h = Number(s.slice(0, -2));
    m = Number(s.slice(-2));
  }
  else if (CLOCK_COLON.test(s)) {
    const [hh, mm] = s.split(':');
    h = Number(hh);
    m = Number(mm);
  }
  else {
    return null;
  }
  if (h > 23 || m > 59)
    return null;
  return h * 60 + m;
}

export function formatClock(iso: string): string {
  return format(new Date(iso), 'HH:mm');
}

/**
 * Manuel post: dato (yyyy-MM-dd) + fra/til-klokkeslæt. Slut før start = over midnat.
 * Returnerer ISO-tidspunkter eller en fejl.
 */
export function manualRange(dateKey: string, from: string, to: string): { startedAt: string; endedAt: string } | { error: 'invalid_time' | 'zero' } {
  const a = parseClock(from);
  const b = parseClock(to);
  if (a === null || b === null)
    return { error: 'invalid_time' };
  if (a === b)
    return { error: 'zero' };
  const [y, mo, d] = dateKey.split('-').map(Number);
  const start = new Date(y!, mo! - 1, d!, Math.floor(a / 60), a % 60);
  const end = new Date(y!, mo! - 1, d!, Math.floor(b / 60), b % 60);
  if (b < a)
    end.setDate(end.getDate() + 1);
  return { startedAt: start.toISOString(), endedAt: end.toISOString() };
}

export function hasLocalData(data: Pick<LocalData, 'clients' | 'projects' | 'tags' | 'entries' | 'timer'>): boolean {
  return data.entries.length > 0 || data.clients.length > 0 || data.projects.length > 0 || data.tags.length > 0 || data.timer !== null;
}

// --- Overførsel til konto ---------------------------------------------------

/** lokal id → server-id for kunder, projekter og tags (samt poster, så et afbrudt forløb kan genoptages). */
export type RemoteIdMap = Record<string, string>;

export const FALLBACK_DESCRIPTION = 'Tidsregistrering';

/** Input til `time.create` (web's createTimeEntryInput) for en lokal post. */
export function toTimeCreateInput(e: LocalEntry, ids: RemoteIdMap) {
  const hours = Math.max(0.01, Math.round(entryHours(e) * 100) / 100);
  return {
    clientEntryId: e.id,
    description: (e.description.trim() || FALLBACK_DESCRIPTION).slice(0, 500),
    hours,
    date: format(new Date(e.startedAt), 'yyyy-MM-dd'),
    startTime: new Date(e.startedAt).toISOString(),
    endTime: new Date(e.endedAt).toISOString(),
    projectId: e.projectId ? ids[e.projectId] : undefined,
    clientId: e.clientId ? ids[e.clientId] : undefined,
  };
}

/** Find et eksisterende server-objekt med samme navn (så overførslen ikke laver dubletter). */
export function matchByName<T extends { id: string; name: string }>(remote: readonly T[], name: string): string | null {
  const lower = name.trim().toLocaleLowerCase(intlLocale());
  return remote.find(r => r.name.trim().toLocaleLowerCase(intlLocale()) === lower)?.id ?? null;
}

export type ImportCounts = { entries: number; clients: number; projects: number; tags: number; seconds: number };

export function importCounts(data: LocalData): ImportCounts {
  return {
    entries: data.entries.length,
    clients: data.clients.length,
    projects: data.projects.length,
    tags: data.tags.length,
    seconds: data.entries.reduce((acc, e) => acc + entrySeconds(e), 0),
  };
}

// --- Dage og hurtig indtastning ------------------------------------------------

/** Poster der starter på den lokale dag `dayKey` (yyyy-MM-dd), ældste først. */
export function entriesOnDay(entries: readonly LocalEntry[], dayKey: string): LocalEntry[] {
  return entries
    .filter(e => format(new Date(e.startedAt), 'yyyy-MM-dd') === dayKey)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/** Timer pr. dag for de givne dage (til dagsstrimlen). */
export function hoursPerDay(entries: readonly LocalEntry[], dayKeys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(dayKeys.map(d => [d, 0]));
  for (const e of entries) {
    const key = format(new Date(e.startedAt), 'yyyy-MM-dd');
    if (key in out)
      out[key]! += entryHours(e);
  }
  return out;
}

function toClock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "9" + 90 → "10:30". Null hvis starttiden er ugyldig. Går hen over midnat. */
export function addMinutesToClock(clock: string, minutes: number): string | null {
  const start = parseClock(clock);
  return start === null ? null : toClock(start + minutes);
}

/** Normaliser brugerens indtastning til "HH:mm" (fx "830" → "08:30"), ellers uændret. */
export function normalizeClock(input: string): string {
  const m = parseClock(input);
  return m === null ? input : toClock(m);
}

export const DEFAULT_DAY_START = '08:00';

/**
 * Forslag til fra/til på en dag: fortsæt hvor dagens seneste post sluttede (ellers 08:00).
 * I dag slutter forslaget "nu" hvis det ligger efter start, ellers én time senere.
 */
export function suggestRange(entries: readonly LocalEntry[], dayKey: string, now: Date): { from: string; to: string } {
  const day = entriesOnDay(entries, dayKey);
  const last = day.reduce<string | null>((acc, e) => (!acc || Date.parse(e.endedAt) > Date.parse(acc) ? e.endedAt : acc), null);
  const lastSameDay = last && format(new Date(last), 'yyyy-MM-dd') === dayKey ? format(new Date(last), 'HH:mm') : null;
  const from = lastSameDay ?? DEFAULT_DAY_START;
  const fromMin = parseClock(from)!;
  const isToday = format(now, 'yyyy-MM-dd') === dayKey;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const to = isToday && nowMin > fromMin ? toClock(nowMin) : toClock(Math.min(fromMin + 60, 23 * 60 + 59));
  return { from, to };
}

// --- Statistik ------------------------------------------------------------------

export type PeriodMode = 'week' | 'month' | 'year';
export type StatsMode = PeriodMode | 'custom';
export type DayRange = { start: string; end: string };

function keyOf(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

function dateOf(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Ugen (mandag–søndag) eller måneden omkring `anchor` som dagnøgler (inkl. begge ender). */
export function periodRange(mode: PeriodMode, anchor: Date): DayRange {
  if (mode === 'year')
    return { start: `${anchor.getFullYear()}-01-01`, end: `${anchor.getFullYear()}-12-31` };
  if (mode === 'week') {
    const offset = (anchor.getDay() + 6) % 7;
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - offset);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return { start: keyOf(start), end: keyOf(end) };
  }
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { start: keyOf(start), end: keyOf(end) };
}

/** Flyt ankeret én uge/måned frem eller tilbage. */
export function shiftAnchor(mode: PeriodMode, anchor: Date, dir: 1 | -1): Date {
  if (mode === 'year')
    return new Date(anchor.getFullYear() + dir, 0, 1);
  return mode === 'week'
    ? new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * dir)
    : new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}

/** Alle dagnøgler i intervallet (byttes om hvis start > end). */
export function daysInRange(range: DayRange): string[] {
  const [a, b] = range.start <= range.end ? [range.start, range.end] : [range.end, range.start];
  const out: string[] = [];
  for (let d = dateOf(a); keyOf(d) <= b; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))
    out.push(keyOf(d));
  return out;
}

export type Bucket = { id: string | null; name: string; seconds: number; color?: string };

export type Stats = {
  totalSeconds: number;
  count: number;
  activeDays: number;
  byDay: Array<{ key: string; seconds: number }>;
  byProject: Bucket[];
  byClient: Bucket[];
  byTag: Bucket[];
};

function addTo(map: Map<string | null, number>, id: string | null, s: number) {
  map.set(id, (map.get(id) ?? 0) + s);
}

function toBuckets(map: Map<string | null, number>, name: (id: string | null) => string, color?: (id: string) => string | undefined): Bucket[] {
  return Array.from(map.entries(), ([id, seconds]) => ({ id, name: name(id), seconds, color: id && color ? color(id) : undefined }))
    .sort((a, b) => b.seconds - a.seconds);
}

/** Statistik for poster der starter i intervallet (lokal dato). `none` = navn for "uden projekt/kunde". */
export function computeStats(data: Pick<LocalData, 'entries' | 'projects' | 'clients' | 'tags'>, range: DayRange, none: string): Stats {
  const days = daysInRange(range);
  const perDay = new Map(days.map(d => [d, 0]));
  const projects = new Map<string | null, number>();
  const clients = new Map<string | null, number>();
  const tags = new Map<string | null, number>();
  let count = 0;
  for (const e of data.entries) {
    const key = keyOf(new Date(e.startedAt));
    if (!perDay.has(key))
      continue;
    const s = entrySeconds(e);
    count++;
    perDay.set(key, perDay.get(key)! + s);
    addTo(projects, e.projectId, s);
    addTo(clients, e.clientId, s);
    for (const t of e.tagIds)
      addTo(tags, t, s);
  }
  const byDay = days.map(key => ({ key, seconds: perDay.get(key)! }));
  const nameIn = (list: readonly { id: string; name: string }[]) => (id: string | null) => list.find(x => x.id === id)?.name ?? none;
  return {
    totalSeconds: byDay.reduce((acc, d) => acc + d.seconds, 0),
    count,
    activeDays: byDay.filter(d => d.seconds > 0).length,
    byDay,
    byProject: toBuckets(projects, nameIn(data.projects)),
    byClient: toBuckets(clients, nameIn(data.clients)),
    byTag: toBuckets(tags, nameIn(data.tags), id => data.tags.find(t => t.id === id)?.color),
  };
}

/** Lange perioder vises pr. uge (mandag-nøgle) i stedet for pr. dag, så søjlerne kan ses. */
export function groupDaysForChart(byDay: Stats['byDay'], maxBars = 31): Array<{ key: string; seconds: number }> {
  if (byDay.length <= maxBars)
    return byDay;
  const weeks = new Map<string, number>();
  for (const d of byDay) {
    const wk = periodRange('week', dateOf(d.key)).start;
    weeks.set(wk, (weeks.get(wk) ?? 0) + d.seconds);
  }
  return Array.from(weeks.entries(), ([key, seconds]) => ({ key, seconds }));
}

/** Summer pr. måned (nøgle yyyy-MM) — til årsoversigten. */
export function groupDaysByMonth(byDay: Stats['byDay']): Array<{ key: string; seconds: number }> {
  const months = new Map<string, number>();
  for (const d of byDay) {
    const key = d.key.slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + d.seconds);
  }
  return Array.from(months, ([key, seconds]) => ({ key, seconds }));
}

// --- CSV-eksport ---------------------------------------------------------------

const CSV_NEEDS_QUOTES = /[;"\n\r]/;

function csvCell(value: string): string {
  return CSV_NEEDS_QUOTES.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Poster i intervallet som CSV til dansk Excel/Numbers: semikolon som separator,
 * decimalkomma i timer, ældste først. BOM foran, så æøå vises korrekt i Excel.
 */
export function entriesToCsv(data: Pick<LocalData, 'entries' | 'projects' | 'clients' | 'tags'>, range: DayRange): string {
  const days = new Set(daysInRange(range));
  const name = (list: readonly { id: string; name: string }[], id: string | null) => list.find(x => x.id === id)?.name ?? '';
  const header = ['Dato', 'Start', 'Slut', 'Timer', 'Beskrivelse', 'Projekt', 'Kunde', 'Tags'];
  const rows = data.entries
    .filter(e => days.has(keyOf(new Date(e.startedAt))))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map(e => [
      keyOf(new Date(e.startedAt)),
      formatClock(e.startedAt),
      formatClock(e.endedAt),
      (Math.round(entryHours(e) * 100) / 100).toFixed(2).replace('.', ','),
      e.description,
      name(data.projects, e.projectId),
      name(data.clients, e.clientId),
      e.tagIds.map(t => name(data.tags, t)).filter(Boolean).join(', '),
    ]);
  return `\uFEFF${[header, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
