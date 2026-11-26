import type { RouterInputs, RouterOutputs } from '~/api/app-router';
import { format as dfFormat, isValid, parse } from 'date-fns';
import { translate } from '~/lib/i18n';
import { dateFnsLocale, dayOfMonth } from '~/lib/locale';

/** En række fra `listShareLinks` — den har visninger og oprettelsestidspunkt. */
export type ShareLink = RouterOutputs['reports']['listShareLinks'][number];

/** Svaret fra `createShareLink` — samme link, men uden de to tællere. */
export type CreatedLink = RouterOutputs['reports']['createShareLink'];

export type ShareConfig = RouterInputs['reports']['createShareLink']['config'];

/**
 * Det et link skal dele: navn og URL.
 *
 * Serveren gemmer kun en hash af tokenet (web #727), så URL'en findes kun i
 * svaret lige efter oprettelsen. Ældre links fra `listShareLinks` har `url: null`
 * og kan ikke deles igen — kun tilbagekaldes.
 */
export type Shareable = { name: string; url: string | null };

/** Serverens `z.string().min(1).max(120)` på `createShareLink.name`. */
export const SHARE_NAME_MAX = 120;

/** Serverens periode-par: `getReportData` svarer `toLocalDateStr(start/end)`. */
export type SharePeriod = { start: string; end: string };

/**
 * Utrimmet navn — serveren tæller tegn, så mellemrum tæller med.
 *
 * Vi sender `.trim()`-et: et navn på bare mellemrum ville ellers passere vores egen
 * længdeprøvning og blive afvist af serveren med en rå zod-fejl.
 */
export function trimmedShareName(name: string): string {
  return name.trim();
}

/** Kan der oprettes et link med dette navn? Samme grænser som serverens zod. */
export function canCreateLink(name: string): boolean {
  const length = trimmedShareName(name).length;
  return length >= 1 && length <= SHARE_NAME_MAX;
}

/** `parse` på egen reference: `2026-02-31` er **ugyldig**, ikke 3. marts. */
function parseDate(value: string): Date | null {
  const d = parse(value.trim(), 'yyyy-MM-dd', new Date());
  return isValid(d) ? d : null;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Perioden som en læsbar streng: én kalendermåned bliver «Oktober 2026», ellers
 * «1. okt. 2026 – 31. okt. 2026».
 *
 * Datoerne kommer fra **`getReportData`**, ikke fra en lokal nyberegning — så
 * navnet ikke kan komme til at sige en anden periode end den rapporten viser.
 *
 * En periode på tværs af måneder får **år på begge** datoer. `formatDateShort`
 * skjuler året for datoer i indeværende år, så «29. dec. 2025 – 4. jan.» læses
 * som om januar lå før december, selv om den ikke gør det.
 */
export function periodLabel(period: SharePeriod): string {
  const start = parseDate(period.start);
  const end = parseDate(period.end);
  if (!start || !end)
    return translate('reports.share.period_unknown');
  const oneMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
  if (oneMonth)
    return capitalize(dfFormat(start, 'LLLL yyyy', { locale: dateFnsLocale() }));
  const day = (date: Date) => capitalize(dfFormat(date, `${dayOfMonth()} MMM yyyy`, { locale: dateFnsLocale() }));
  return `${day(start)} – ${day(end)}`;
}

/**
 * Teksten der sendes til share-arket: navnet på linket og URL'en.
 *
 * Den bruges både ved oprettelse og ved «Del igen», så den har ét sted — en
 * fremtidig ændring i rækkefølgen kan så ikke ramme den ene vej.
 */
export function shareMessage(link: Shareable): string | null {
  return link.url ? `${link.name}\n${link.url}` : null;
}

/** Standardnavn på nyt link, så feltet ikke er tomt ved åbning. */
export function defaultShareName(period: SharePeriod): string {
  return translate('reports.share.default_name', { period: periodLabel(period) });
}

/**
 * Undertitel på et eksisterende link: om perioden er låst, og hvor mange gange
 * den er set. Begge tal kommer fra serverens egen række.
 *
 * Tælles i to nøgler (`_one`/`_other`) frem for i i18nexts `count`-flertal, fordi
 * appen ikke har slået plurals til og ellers ville vise `_one` for alle tal.
 */
export function linkSubtitle(link: ShareLink): string {
  const period = link.lockedDates
    ? translate('reports.share.locked')
    : translate('reports.share.rolling');
  const { viewCount } = link;
  const views = viewCount === 1
    ? translate('reports.share.views_one', { count: viewCount })
    : translate('reports.share.views_other', { count: viewCount });
  const parts = [period, views];
  if (!link.url)
    parts.push(translate('reports.share.reshare_unavailable'));
  return parts.join(' · ');
}
