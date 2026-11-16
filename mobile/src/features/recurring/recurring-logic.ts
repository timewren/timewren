import type { RouterOutputs } from '~/api/app-router';
import { format as dfFormat } from 'date-fns';
import { dateFnsLocale } from '~/lib/locale';

export type Template = RouterOutputs['recurring']['list'][number];
export type Pending = RouterOutputs['recurring']['getPending'][number];

/**
 * `getPending` svarer uden `templateClients`, og den liste må vi ikke selv
 * regne på (`lte(nextDue, now)` er serverens præmis, punkt F1 del 2). Så
 * henter vi *kataloger* med `list` og slår den fulde række op efter id.
 */
export type Row = Pending & { templateClients: Template['templateClients'] };

/** Pending-rækkerne, hæftet på den fulde skabelon de hører til. */
export function mergePending(pending: Pending[], all: Template[]): Row[] {
  const byTemplate = new Map(all.map(t => [t.id, t]));
  return pending.map(p => ({ ...p, templateClients: byTemplate.get(p.id)?.templateClients ?? [] }));
}

/**
 * Hvem tiden skrives på.
 *
 * `generate` bruger `template.clientId` og falder tilbage på projektets kunde —
 * samme rækkefølge som serverens egen `generate` og cron'en. Uden en kunde
 * skriver den på intet, og det skal være synligt frem for at se ud som en
 * kunde med tomt navn.
 */
export function clientLabel(row: Row): string | null {
  return row.client?.name ?? row.project?.client?.name ?? row.project?.name ?? null;
}

export type FrequencyKey
  = | 'recurring.frequency_daily'
    | 'recurring.frequency_weekly'
    | 'recurring.frequency_weekly_day'
    | 'recurring.frequency_monthly'
    | 'recurring.frequency_monthly_day'
    | 'recurring.frequency_none';

export type Frequency = { key: FrequencyKey; vars?: { day: string } };

/**
 * Ugens og månedens dag kommer fra kalenderen, ikke fra et array.
 *
 * `dayOfWeek` er JS' `getDay()`-værdi (0 = søndag), så en hardkodet liste kunne
 * ramme en dag forskert. 4. januar 2026 er en søndag, så `day + 4` lander på
 * den rigtige ugedag.
 */
const SUNDAY = 4; // 2026-01-04

export function weekdayName(dayOfWeek: number | null | undefined): string | null {
  if (typeof dayOfWeek !== 'number' || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)
    return null;
  return dfFormat(new Date(2026, 0, SUNDAY + dayOfWeek), 'EEEE', { locale: dateFnsLocale() });
}

export function frequency(row: Row): Frequency {
  if (row.frequency === 'daily')
    return { key: 'recurring.frequency_daily' };
  if (row.frequency === 'weekly') {
    const day = weekdayName(row.dayOfWeek);
    return day ? { key: 'recurring.frequency_weekly_day', vars: { day } } : { key: 'recurring.frequency_weekly' };
  }
  if (row.frequency === 'monthly') {
    const day = typeof row.dayOfMonth === 'number' && Number.isInteger(row.dayOfMonth) && row.dayOfMonth >= 1 && row.dayOfMonth <= 31
      ? String(row.dayOfMonth)
      : null;
    return day ? { key: 'recurring.frequency_monthly_day', vars: { day } } : { key: 'recurring.frequency_monthly' };
  }
  return { key: 'recurring.frequency_none' };
}

/**
 * Hvorfor serverens `generate` ikke må kaldes for den her skabelon.
 *
 * `generate` er cron'ens *simple søskende*, ikke cron'en: den laver én tidspost
 * og ingenting mere. Hver undtagelse her er læst i `recurring.ts` (proceduren)
 * og `api/cron/recurring/route.ts` (cron'en), der gør mere:
 *
 * - `templateType: 'task' | 'both'` — cron'en opretter også en opgave.
 * - `isPrepaid` — cron'en trækker timer af klippekortet (`deductHoursCore`).
 * - `templateClients` — cron'en skriver én post pr. kunde.
 *
 * Uden den her tjek ville appen skrive præcis den del, serveren kan, og lade
 * resten ligge: en opgave der aldrig kommer, et klippekort der ikke er trukket
 * af, eller halvdelen af kunderne.
 */
export type Block = 'task' | 'prepaid' | 'multi_client';

/**
 * Hvorfor serverens `generate` ikke dækker skabelonen — én tekst pr. grund.
 *
 * Delt, fordi de samme tre grunde går igen to steder: på rækken i katalogen og
 * på den netop gemte skabelon, hvorfra den samme procedure kan kaldes.
 */
export const BLOCK_TEXT: Record<Block, 'recurring.blocked_task' | 'recurring.blocked_prepaid' | 'recurring.blocked_multi'> = {
  task: 'recurring.blocked_task',
  prepaid: 'recurring.blocked_prepaid',
  multi_client: 'recurring.blocked_multi',
};

export function generateBlock(row: Row): Block | null {
  if (row.templateType !== 'time_entry')
    return 'task';
  if (row.isPrepaid)
    return 'prepaid';
  if (row.templateClients.length > 0)
    return 'multi_client';
  return null;
}

/** Skabelonen er sat på pause eller slået fra, så den løber ikke. */
export function isParked(row: Row): 'paused' | 'inactive' | null {
  if (row.isPaused)
    return 'paused';
  if (row.isActive === false)
    return 'inactive';
  return null;
}

/**
 * Kan serveren overhovedet pause den her skabelon?
 *
 * NB om datoer: `pause` **skriver** `pausedUntil`, men ingen læser den — hverken
 * cron'en (`api/cron/recurring/route.ts:77`) eller `getPending` (routeren:273)
 * prøver andet end `isPaused = false`. Derfor sender appen ingen dato: en ferie-
 * pause med dato ville være et løfte om automatisk genoptagelse, der aldrig
 * kommer. Og `resume` regner `nextDue` fra `new Date()` (routeren:879), ikke
 * fra den dato den var pauset, så den tabte tid lægges heller ikke ind
 * bagefter — skærmen siger begge dele. Kravet om automatisk genoptagelse står i
 * `docs/api-behov.md`.
 *
 *
 * `recurring.pause` kaster «Kan ikke pause en ikke-gentagende skabelon» når
 * `frequency` er null (læst i `routers/recurring.ts:839`), og `resume` kaster
 * den tilsvarende fejl. Det er ikke en fejlstatus — det er **ikke en pause,
 * brugeren kan se**. Uden denne gate får man en rød toast om en handling,
 * der aldrig kunne lade sig gøre, og knappen forsvinder så snart kaldet er
 * gennemført — urolig.
 */
export function canPause(row: Row): boolean {
  return row.frequency !== null;
}

/**
 * Den én handling, der tilbydes på rækken — eller `null`, hvis ingen.
 *
 * Der er **tre** statusser, ikke to, og de er ikke hinandens modsætninger:
 *
 * - `resume` rydder `isPaused`, men rører ikke `isActive` (routeren:886-895).
 * - `toggleActive` sætter `isActive`, men rører ikke `isPaused` (routeren:809).
 *
 * Så en skabelon der er både pauset og slået fra kan ikke genoptages ved at
 * trykke den samme knap to gange — den skal have den ene handling ad gangen, og
 * ellers får brugeren en grøn kvittering på en skabelon der stadig ikke løber.
 */
export type ParkAction = 'pause' | 'resume' | 'activate';

/** Hvad brugeren kan gøre ved den her række lige nu. */
export function parkAction(row: Row): ParkAction | null {
  const parked = isParked(row);
  if (parked === 'paused') {
    // `resume` kaster uden `frequency` (routeren:875). En sådan pause er kun
    // nået uden om appen, så vi lader den stå og siger hvor den genoptages.
    return canPause(row) ? 'resume' : null;
  }
  // Slået fra kan ikke pauses oveni: serveren ville sætte `isPaused = true`, men
  // `getPending` og cron'en kræver også `isActive = true` (routeren:272), så
  // den ville stadig ikke løbe — og brugeren ville se to badges.
  if (parked === 'inactive')
    return 'activate';
  return canPause(row) ? 'pause' : null;
}
