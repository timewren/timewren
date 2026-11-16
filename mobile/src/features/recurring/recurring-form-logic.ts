import type { Block } from './recurring-logic';
import type { RouterInputs, RouterOutputs } from '~/api/app-router';
import { parseHoursInput } from '~/features/entries/duration';
import { isISODate } from '~/features/prepaid/prepaid-logic';
import { toISODate } from '~/lib/format';
import { translate } from '~/lib/i18n';

type CreateInput = RouterInputs['recurring']['create'];
type UpdateInput = RouterInputs['recurring']['update'];
type Existing = RouterOutputs['recurring']['getById'];
/** Den række serveren gemte ved `create` — samme procedure som `generate` læser. */
export type Created = RouterOutputs['recurring']['create'];

export type Frequency = 'daily' | 'weekly' | 'monthly';
export type TemplateType = 'time_entry' | 'task' | 'both';

export type RecurringFormValues = {
  name: string;
  description: string;
  hours: string;
  clientId: string | null;
  projectId: string | null;
  prepaidPackageId: string | null;
  isPrepaid: boolean;
  templateType: TemplateType;
  /** `null` = engangsklage, så ingen startdato og ingen `nextDue`. */
  frequency: Frequency | null;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
};

export type RecurringFormErrors = Partial<Record<keyof RecurringFormValues, string>>;

export function emptyRecurring(clientId: string | null = null): RecurringFormValues {
  return {
    name: '',
    description: '',
    hours: '',
    clientId,
    projectId: null,
    prepaidPackageId: null,
    isPrepaid: false,
    templateType: 'time_entry',
    frequency: 'weekly',
    dayOfWeek: 1,
    dayOfMonth: 1,
    startDate: toISODate(new Date()),
    endDate: '',
    isActive: true,
  };
}

/**
 * Formularens startværdier ud fra en gemt skabelon.
 *
 * `startDate`/`endDate` er **tidspunkter** i DB'en (UTC-midnat), så de skrives
 * som ISO-dage — ellers ville et gemt klokkeslæt blive gentaget. Ugyldige eller
 * manglende værdier falder tilbage på `emptyRecurring`, fordi serveren regner
 * videre på dem.
 */
export function recurringFromTemplate(t: Existing, today = new Date()): RecurringFormValues {
  const base = emptyRecurring(t.clientId ?? t.project?.clientId ?? null);
  return {
    ...base,
    name: t.name,
    description: t.description,
    hours: String(t.hours),
    projectId: t.projectId ?? null,
    prepaidPackageId: t.prepaidPackageId ?? null,
    isPrepaid: t.isPrepaid === true,
    templateType: toTemplateType(t.templateType),
    frequency: toFrequency(t.frequency),
    dayOfWeek: t.dayOfWeek ?? base.dayOfWeek,
    dayOfMonth: t.dayOfMonth ?? base.dayOfMonth,
    startDate: toDay(t.startDate) ?? toISODate(today),
    endDate: toDay(t.endDate) ?? '',
    isActive: t.isActive !== false,
  };
}

/**
 * `isISODate` tjekker formen og at `new Date(...)` ikke er `NaN` — men JS ruller
 * «2026-02-31» hen til 3. marts, så den tager en dato, kalenderen ikke har. Her
 * sammenlignes derfor de tre dele med kalenderens egne, så skabelonen ikke
 * gemmer en dag, brugeren aldrig skrev.
 */
function isRealISODate(value: string): boolean {
  if (!isISODate(value))
    return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * `getById` svarer med DB-kolonnernes brede typer (`templateType: string`,
 * `isActive: boolean | null`), så formularen får kun de tre værdier serveren
 * faktisk kan håndtere. En ukendt værdi falder tilbage på den forsvarlige
 * standard — en ukendt hyppighed er en engangsklage, for det er det `frequency:
 * null` betyder i både cron'en og `getPending`.
 */
function toTemplateType(value: string): TemplateType {
  return value === 'task' || value === 'both' ? value : 'time_entry';
}

function toFrequency(value: string | null): Frequency | null {
  return value === 'daily' || value === 'weekly' || value === 'monthly' ? value : null;
}

function toDay(value: Date | string | null | undefined): string | null {
  if (!value)
    return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : toISODate(date);
}

/**
 * Spejler `recurringTemplateInput` (routeren:17-40).
 *
 * To krav er ikke synlige i input-schemaet, men serveren håndhæver dem:
 * `create` kaster «Startdato er påkrævet for gentagende skabeloner» (routeren:382),
 * og `generate` skriver på `template.clientId` og ellers intet (routeren:723), så
 * en ugentlig skabelon uden kunde lægger tiden på ingen. Begge fanges her frem
 * for som en rød toast efter et kald.
 */
export function validateRecurring(v: RecurringFormValues): RecurringFormErrors {
  const errors: RecurringFormErrors = {};
  if (v.name.trim().length < 2)
    errors.name = translate('recurring.error_name');
  if (!v.description.trim())
    errors.description = translate('recurring.error_description');
  // Timer er påkrævet for *alle* typer: `hours` er `z.string().min(1)` (routeren:22),
  // også når skabelonen kun laver en opgave.
  const hours = parseHoursInput(v.hours);
  if (hours === null || hours < 0.25)
    errors.hours = translate('recurring.error_hours');
  if (v.frequency && !v.clientId && !v.projectId)
    errors.clientId = translate('recurring.error_client');
  if (v.frequency === 'weekly' && v.dayOfWeek === null)
    errors.dayOfWeek = translate('recurring.error_day');
  if (v.frequency === 'monthly' && v.dayOfMonth === null)
    errors.dayOfMonth = translate('recurring.error_day');
  if (v.frequency) {
    if (!isRealISODate(v.startDate.trim()))
      errors.startDate = translate('recurring.error_date');
    if (v.endDate.trim()) {
      if (!isRealISODate(v.endDate.trim()))
        errors.endDate = translate('recurring.error_date');
      else if (v.endDate.trim() < v.startDate.trim())
        errors.endDate = translate('recurring.error_end_before_start');
    }
  }
  return errors;
}

/**
 * Timer sendes som punktum-streng, ikke dansk decimalkomma.
 *
 * `hours` er `z.string()` (routeren:22) og lægges direkte i `timeEntries.hours`
 * (routeren:744), som er numerisk i Postgres — «1,5» er ikke gyldig numerik dér.
 * Web sender også punktum, fra sit `input type="number"`. Feltet må stå dansk,
 * fordi `parseHoursInput` tager «1,5», «1:30» og «90m»; på leddet sendes et tal.
 */
export function normalizeHours(text: string): string {
  const hours = parseHoursInput(text);
  return hours === null ? '' : String(hours);
}

/** Skal klippekort-pakken overhovedet vælges, eller ryddes den? */
export function wantsPackage(v: RecurringFormValues): boolean {
  return v.isPrepaid && !!v.prepaidPackageId;
}

function shared(v: RecurringFormValues) {
  return {
    name: v.name.trim(),
    description: v.description.trim(),
    hours: normalizeHours(v.hours),
    clientId: v.clientId,
    projectId: v.projectId,
    isPrepaid: v.isPrepaid,
    templateType: v.templateType,
    // Uden hyppighed er det en engangsklage, og så sendes hverken start- eller
    // slutdato: ellers ville `update` sætte `nextDue` på en skabelon der aldrig
    // skal forfalde, og den ville stå som «klar nu» i `getPending`.
    frequency: v.frequency,
    dayOfWeek: v.frequency === 'weekly' ? (v.dayOfWeek ?? undefined) : undefined,
    dayOfMonth: v.frequency === 'monthly' ? (v.dayOfMonth ?? undefined) : undefined,
    startDate: v.frequency ? v.startDate.trim() : undefined,
    endDate: v.frequency && v.endDate.trim() ? v.endDate.trim() : undefined,
  };
}

export function toCreateInput(v: RecurringFormValues): CreateInput {
  return {
    ...shared(v),
    prepaidPackageId: wantsPackage(v) ? (v.prepaidPackageId ?? undefined) : undefined,
    isActive: v.isActive,
  };
}

/**
 * Kan den netop gemte skabelon registreres med ét tryk?
 *
 * Samme tre undtagelser som `generateBlock` på katalogrækken — de skyldes at
 * `generate` er cron'ens *simple søskende*: den laver én tidspost og ingenting
 * mere, så en opgaveskabelon ville få en post uden opgaven, en klippekortskabelon
 * en post uden optrækning, og en flerkundeskabelon kun den første kunde.
 *
 * Grundene læses på **serverens egen række** og ikke på formularens værdier:
 * `create` gemte den, og `generate` læser den — så det er den samme sandhed
 * begge steder. Rækkefølgen er `generateBlock`s, så en skabelon der er både
 * opgave og klippekort får den Grund, der rammer tidligst.
 */
export function createdBlock(created: Created, extraClients: number): Block | null {
  if (created.templateType !== 'time_entry')
    return 'task';
  if (created.isPrepaid)
    return 'prepaid';
  if (extraClients > 0)
    return 'multi_client';
  return null;
}

/**
 * Til `recurring.update`.
 *
 * To forskelle fra `create`, begge serverens egen opførsel:
 *
 * - `clientIds` sendes **aldrig**. Serveren rører `recurringTemplateClients` kun
 *   når feltet er med (routeren:595), så en skabelon med flere kunder beholder dem,
 *   selv om den redigeres på telefonen. Her er `undefined` altså «rørte ikke».
 * - `prepaidPackageId` sendes også når brugeren **sletter** valget (`null`),
 *   fordi serveren kun nulstiller feltet når det er sendt (routeren:471).
 */
export function toUpdateInput(id: string, v: RecurringFormValues): UpdateInput {
  const base = shared(v);
  return {
    id,
    name: base.name,
    description: base.description,
    hours: base.hours,
    clientId: base.clientId ?? null,
    projectId: base.projectId ?? null,
    prepaidPackageId: v.isPrepaid ? (v.prepaidPackageId ?? null) : null,
    isPrepaid: base.isPrepaid,
    // `isActive` og `isPaused` er to statusser og ikke hinandens modsætninger:
    // pause rydder kun det ene, og `getPending` kræver begge (routeren:272-273).
    // Skærmen viser derfor de to ad gang, og pause-knappen på rækken er den der
    // rører `isPaused`.
    isActive: v.isActive,
    templateType: base.templateType,
    frequency: base.frequency,
    ...(base.frequency
      ? {
          dayOfWeek: base.dayOfWeek ?? null,
          dayOfMonth: base.dayOfMonth ?? null,
          startDate: base.startDate,
          endDate: base.endDate ?? null,
        }
      : {}),
  };
}
