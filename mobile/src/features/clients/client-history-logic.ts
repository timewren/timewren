import type { TxKeyPath } from '~/lib/i18n';
import { formatDateRelative, formatMoney, formatTime } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { intlLocale } from '~/lib/locale';

/**
 * Kundehistorikken (feature-kø F5): hvem der har rørt kunden, hvad de
 * ændrede, og hvornår.
 *
 * Kilden er `activity.list` med `entityType: 'client'`, som serveren skriver
 * fra `clients.create/update/archive/restore/delete` (`logActivity` i web's
 * `routers/activity.ts`). Web har samme data i `ActivityLogWidget`, men den
 * bruges ingen steder — historikken har altså aldrig været synlig for nogen.
 *
 * **`changes` er `jsonb` og helt utypet** (`Record<string, unknown>` i
 * router-output, fordi `logActivity` caster til den type). Serien er i praksis
 * `FieldChange[]` — `{ field, fieldLabel, before, after }` — men intet i
 * serveren sikrer det, så alt læses gennem `readChanges()` her, som kaster
 * væk alt der ikke passer på formen. Uden den ville et billede eller en
 * fremtidig `metadata`-form få skærmen til at male `[object Object]`.
 */

/**
 * Serverens `activity.list`-grænse. Skærmen beder om samme tal, så den
 * viste liste og den afkortede note aldrig kan komme i uoverensstemmelse.
 */
export const HISTORY_LIMIT = 20;

/** Kun de felter fra `activity.list`-rækkerne, som historikken bruger. */
export type HistoryLog = { id: string; action: string; entityName?: string | null; changes?: unknown; createdAt: Date | string | null; user?: { id: string; name: string; image?: string | null } | null };

export type HistoryChange = {
  /** Nøglen i klienten, fx `defaultHourlyRate`. Bruges til felt-oversættelsen. */
  field: string;
  /** Feltets navn, når vi ikke kender nøglen. */
  label: string;
  before: string;
  after: string;
};

export type HistoryEntry = {
  id: string;
  /** Serverens rå handling, fx `create`. Bruges til ikonet, ikke til at vise. */
  action: string;
  actionKey: TxKeyPath;
  /** «I dag 14:32» — `createdAt` er et rigtigt tidspunkt, ikke en dato-kolonne. */
  when: string;
  /** «Mads Holst Jensen», eller tom når serveren ikke gav et navn med. */
  who: string;
  changes: HistoryChange[];
};

/**
 * Handlinger serveren faktisk skriver for en kunde (`clients.ts`): oprettelse,
 * rettelse, arkivering, gendannelse og sletning. `delete` arkiverer i praksis
 * (`clients.ts:979` logger den som `delete`), så den har sin egen etiket.
 */
const ACTIONS: Record<string, TxKeyPath> = {
  archive: 'clients.history_action_archive',
  create: 'clients.history_action_create',
  delete: 'clients.history_action_delete',
  restore: 'clients.history_action_restore',
  update: 'clients.history_action_update',
};

/** Felterne `detectChanges` kan skrive på en kunde, med deres danske navn. */
const FIELDS: Record<string, TxKeyPath> = {
  address: 'clients.address',
  city: 'clients.city',
  company: 'clients.company',
  country: 'clients.country',
  cvrNumber: 'clients.cvr',
  defaultBillable: 'clients.history_billable',
  defaultHourlyRate: 'clients.hourly_rate',
  email: 'clients.email',
  name: 'clients.name',
  notes: 'clients.notes',
  phone: 'clients.phone',
  postalCode: 'clients.postal_code',
};

/** Felter hvis værdi er et beløb, så den vises som kroner og ikke som rå tal. */
const MONEY_FIELDS = new Set(['defaultHourlyRate']);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Én værdi fra `changes` som tekst.
 *
 * `null` er hverken «0» eller tom streng: serverens `detectChanges`
 * normaliserer `undefined` til `null` (`activity.ts:66`), så en ryddet e-mail
 * står som «—» og ikke som «null». En streng der ligner en dato (`2026-10-01`)
 * vises som dato — den er skrevet af serveren som ISO-streng, ikke som
 * tidsstempel. Objekt og array har ingen læsbar form, og `String()` ville male
 * «[object Object]», så de vises som «—».
 */
export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined)
    return '—';
  if (typeof value === 'boolean')
    return translate(value ? 'common.yes' : 'common.no');
  if (typeof value === 'number')
    return Number.isFinite(value) ? (MONEY_FIELDS.has(field) ? formatMoney(value) : value.toLocaleString(intlLocale())) : '—';
  if (typeof value !== 'string')
    return '—';
  const text = value.trim();
  if (!text)
    return '—';
  if (ISO_DATE.test(text))
    return formatDateRelative(text);
  if (MONEY_FIELDS.has(field)) {
    const tal = Number.parseFloat(text.replace(',', '.'));
    if (Number.isFinite(tal))
      return formatMoney(tal);
  }
  return text;
}

/** Ét element i `changes`, hvis det har den form serveren skriver. */
function toChange(element: unknown): HistoryChange | null {
  if (!element || typeof element !== 'object' || Array.isArray(element))
    return null;
  const { field, fieldLabel, before, after } = element as Record<string, unknown>;
  if (typeof field !== 'string' || !field)
    return null;
  // `before`/`after` mangler kun når serveren har skrevet en anden form, så
  // da springes feltet frem for at vise to «—».
  if (!('before' in element) || !('after' in element))
    return null;
  const key = FIELDS[field];
  return {
    field,
    label: key ? translate(key) : (typeof fieldLabel === 'string' && fieldLabel ? fieldLabel : field),
    before: formatValue(field, before),
    after: formatValue(field, after),
  };
}

/**
 * Rækken `changes` som læsbare ændringer.
 *
 * Alt der ikke er et `{ field, before, after }`-objekt i et array kastes væk,
 * så historikken aldrig viser `[object Object]` eller kaster under render.
 * Rækkefølgen er serverens, som følger `clientFieldLabels` — den læses kun.
 */
export function readChanges(changes: unknown): HistoryChange[] {
  if (!Array.isArray(changes))
    return [];
  return changes.map(toChange).filter((change): change is HistoryChange => change !== null);
}

/**
 * Én log-række som en historik-række.
 *
 * `createdAt` er her et **rigtigt tidspunkt** (`timestamp("created_at")` med
 * `defaultNow()`), ikke en dato-kolonne som `clients.lastActivityDate` der
 * `formatAgo` engang læste som et klokkeslæt — så her vises både dagens dato
 * og klokkeslættet.
 *
 * En ukendt handling får den generiske etiket, ikke serverens rå nøgle: nøglen
 * er sand, men på engelsk midt i en dansk app.
 */
export function toHistoryEntry(log: HistoryLog): HistoryEntry {
  return {
    id: log.id,
    action: log.action,
    actionKey: ACTIONS[log.action] ?? 'clients.history_action_other',
    when: log.createdAt ? `${formatDateRelative(log.createdAt)} ${formatTime(log.createdAt)}`.trim() : '—',
    who: log.user?.name?.trim() ?? '',
    changes: readChanges(log.changes),
  };
}

/**
 * Historikken i den rækkefølge serveren gav: nyeste først.
 *
 * Serveren sorterer på `createdAt` desc, så rækkerne falder ikke alene af sig
 * selv; `sort` er dog stabil i moderne JS, så to rækker med samme tidsstempel
 * beholder serverens rækkefølge.
 */
export function toHistory(logs: readonly HistoryLog[]): HistoryEntry[] {
  return logs.map(toHistoryEntry);
}

/** Sand når intet er logget — så skærmen siger det i stedet for at vise nul. */
export function isEmptyHistory(entries: readonly HistoryEntry[]): boolean {
  return entries.length === 0;
}

/**
 * Er listen klippet af serverens `limit`?
 *
 * Uden denne viser en kunde med 60 hændelser de 20 seneste som om de var alle,
 * og intet på skærmen siger at der er mere. Det er den påstand uden dækning,
 * F3's revision af tal på kundekortet var skrevet for at lukke.
 */
export function isTruncated(logCount: number, limit: number): boolean {
  return logCount >= limit;
}
