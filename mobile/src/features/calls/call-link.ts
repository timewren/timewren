import type { EntryFormState } from '~/features/entries/form-state';
import { initialFormState } from '~/features/entries/form-state';

/**
 * "Log opkald" åbnes med `timetrack://log-opkald?minutter=12&telefon=%2B4512345678`
 * fra en iOS-genvej, en Android-automatisering eller (senere) en notifikation.
 * Alt her er lokalt: nummeret bruges kun til at finde kunden på telefonen og
 * sendes aldrig til serveren.
 */

export const CALL_LINK_PATH = 'log-opkald';
export const DEFAULT_CALL_MINUTES = 15;
/** En tidspost må højst være 24 t. */
export const MAX_CALL_MINUTES = 24 * 60;

export type CallLinkParams = {
  minutter?: string | string[];
  telefon?: string | string[];
};

export type CallLink = {
  /** null = ikke angivet eller ugyldigt → brug standard */
  minutes: number | null;
  phone: string | null;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** "12" → 12 · "12,5" → 13 (rundes op: et påbegyndt minut tæller) · "0"/"abc"/"9999" → null. */
export function parseMinutes(raw: string | undefined): number | null {
  if (!raw)
    return null;
  const n = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0)
    return null;
  const minutes = Math.ceil(n);
  return minutes > MAX_CALL_MINUTES ? null : minutes;
}

export function parseCallLink(params: CallLinkParams): CallLink {
  const phone = first(params.telefon)?.trim();
  return {
    minutes: parseMinutes(first(params.minutter)),
    phone: phone || null,
  };
}

/** Minutter til tidsfeltet — "12m" forstås af samme parser som resten af appen. */
export function minutesToHoursText(minutes: number): string {
  return `${minutes}m`;
}

export type CallPrefill = {
  minutes: number | null;
  /** Kunden nummeret matchede — vinder over seneste kunde */
  matchedClientId: string | null;
  recentClientId: string | null;
  description: string;
  date?: string;
};

/**
 * Formularens start-state: matchet kunde → ellers seneste kunde, varighed fra
 * linket (ellers standard) og IKKE fakturerbar — opkald logges typisk som
 * intern kundetid; brugeren kan slå det til.
 */
export function callEntryState(prefill: CallPrefill): EntryFormState {
  return {
    ...initialFormState(prefill.date),
    clientId: prefill.matchedClientId ?? prefill.recentClientId,
    hoursText: minutesToHoursText(prefill.minutes ?? DEFAULT_CALL_MINUTES),
    description: prefill.description,
    isBillable: false,
  };
}
