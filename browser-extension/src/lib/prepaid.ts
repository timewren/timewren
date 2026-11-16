import { dateFormat } from "../i18n/core";
import type { PrepaidPackage, ServerPrepaidChoice } from "../types";

/**
 * Ren udvælgelseslogik for klippekort i extensionen. Udskilt så timer-storen
 * (Zustand, ingen hooks) og React-fladerne deler ÉN regel — og så reglen kan
 * testes uden browser.
 */

/** Kundens kort der stadig har timer tilbage. */
export function packagesForClient(
  packages: PrepaidPackage[] | undefined,
  clientId: string | null | undefined,
): PrepaidPackage[] {
  if (!packages || !clientId) return [];
  return packages.filter(
    (p) => p.clientId === clientId && p.remainingHours > 0,
  );
}

/**
 * Kortet en ny registrering på kunden skal foreslås trukket fra.
 *
 * Kun kort med auto-træk kommer i betragtning. Er der flere, vælges det der
 * udløber først, så et kort med udløbsdato bruges op inden det forfalder;
 * kort uden udløb kommer sidst. Ved samme udløb (eller to uden) bruges det
 * ældste købte kort først (FIFO). Returnerer null hvis kunden ingen har.
 *
 * Dette er et FORSLAG. Brugeren kan fravælge det, og serveren trækker aldrig
 * uden at extensionen sender et eksplicit kort-id.
 *
 * Web-appen bruger samme regel (src/lib/prepaid/auto-select.ts); pariteten
 * låses af src/lib/prepaid/auto-select.test.ts (#422). Ændres reglen her,
 * skal den ændres begge steder.
 */
export function pickAutoPrepaid(
  packages: PrepaidPackage[] | undefined,
  clientId: string | null | undefined,
): PrepaidPackage | null {
  const candidates = packagesForClient(packages, clientId).filter(
    (p) => p.autoDeduct,
  );
  if (candidates.length === 0) return null;

  return [...candidates].sort((a, b) => {
    const ea = isoMs(a.expiresAt);
    const eb = isoMs(b.expiresAt);
    if (ea !== eb) {
      if (ea === null) return 1;
      if (eb === null) return -1;
      return ea - eb;
    }
    // Samme udløb: ældste købte først (FIFO, A1 P2-6)
    // Manglende købsdato sorterer sidst (total orden, som web)
    const pa = isoMs(a.purchasedAt);
    const pb = isoMs(b.purchasedAt);
    if (pa === pb) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  })[0];
}

function isoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Brugerens valg af klippekort til en registrering.
 * - "auto": foreslå kundens auto-kort (nuværende adfærd, default)
 * - "none": træk ikke fra noget kort
 * - "package": træk fra et konkret kort, også uden auto-træk
 */
export type PrepaidChoice =
  | { mode: "auto" }
  | { mode: "none" }
  | { mode: "package"; packageId: string };

export interface PrepaidResolution {
  /** Kortet der skal trækkes fra — null = intet træk. */
  pkg: PrepaidPackage | null;
  /** True når et eksplicit valgt (pinnet) kort ikke kunne honoreres. */
  pinnedUnavailable: boolean;
}

/**
 * Kortet en registrering skal trækkes fra, givet brugerens valg.
 *
 * En eksplicit brugerbeslutning erstattes ALDRIG stiltiende af noget andet:
 * er det pinnede kort blevet ugyldigt (opbrugt, forsvundet, eller kunden er
 * skiftet), trækkes der IKKE fra auto-kortet i stedet — der trækkes intet,
 * og `pinnedUnavailable` sættes så fladen kan advare tydeligt. Kun
 * auto-mode (ingen aktiv beslutning) må falde tilbage til intet træk.
 */
export function resolvePrepaidPackage(
  choice: PrepaidChoice | null | undefined,
  packages: PrepaidPackage[] | undefined,
  clientId: string | null | undefined,
): PrepaidResolution {
  if (choice?.mode === "none") return { pkg: null, pinnedUnavailable: false };

  if (choice?.mode === "package") {
    const chosen = packagesForClient(packages, clientId).find(
      (p) => p.id === choice.packageId,
    );
    return chosen
      ? { pkg: chosen, pinnedUnavailable: false }
      : { pkg: null, pinnedUnavailable: true };
  }

  return { pkg: pickAutoPrepaid(packages, clientId), pinnedUnavailable: false };
}

/**
 * Serverens gemte valg for timeren (#422) som extensionens `PrepaidChoice` —
 * men kun hvis det gælder timerens nuværende kunde. null = serveren har intet
 * eksplicit valg for kunden (automatisk).
 */
export function fromServerChoice(
  server: ServerPrepaidChoice,
  clientId: string | null | undefined,
): PrepaidChoice | null {
  if (!server || !clientId || server.clientId !== clientId) return null;
  if (server.mode === "none") return { mode: "none" };
  return { mode: "package", packageId: server.packageId };
}

/** Har timeren en session på serveren, som et kortvalg kan gemmes på? */
export function canStoreServerChoice(
  timer:
    | {
        clientId?: string | null;
        isRunning?: boolean;
        elapsedSeconds?: number;
        baseSeconds?: number;
      }
    | null
    | undefined,
): boolean {
  if (!timer?.clientId) return false;
  return (
    !!timer.isRunning ||
    (timer.elapsedSeconds ?? 0) > 0 ||
    (timer.baseSeconds ?? 0) > 0
  );
}

/**
 * Er en createTimeEntry-fejl klippekort-relateret? Serverens prepaid-fejl
 * ("Klippekort ikke fundet", "Klippekortet er udløbet", "Ikke nok timer
 * tilbage på klippekortet…", "klippekort-traek" osv.) nævner alle kortet ved
 * navn — andre fejl (projekt/kunde/periodelås) gør ikke. Bruges til at
 * gemme tiden UDEN træk i stedet for at tabe registreringen.
 */
export function isPrepaidDeductionError(message: string): boolean {
  return /klippekort/i.test(message);
}

export type PrepaidReceiptKind =
  | "deducted"
  | "deducted-overflow"
  | "nothing-deducted";

/**
 * Hvad skete der faktisk ved trækket? Ved invoice-politik og tomt kort
 * svarer serveren overflowedToInvoice=true med hoursDeducted=0 — dér blev
 * INTET trukket, og kvitteringen må ikke påstå det.
 */
export function classifyPrepaidDeduction(deduction: {
  hoursDeducted: number;
  overflowedToInvoice: boolean;
}): PrepaidReceiptKind {
  if (deduction.hoursDeducted <= 0) return "nothing-deducted";
  return deduction.overflowedToInvoice ? "deducted-overflow" : "deducted";
}

/** Persisteret klippekort-valg, bundet til kunde OG timer-session. */
export interface StoredPrepaidChoice {
  choice: PrepaidChoice;
  clientId: string | null;
  /** Timerens startTime da valget blev truffet (null = pauset). */
  sessionStart: string | null;
}

/**
 * Gendan et gemt valg — men kun for præcis den session det blev truffet i.
 * Kunde OG session-nøgle skal matche, så et gammelt "Intet klippekort" fra
 * en tidligere timer på samme kunde aldrig genopstår og tavst blokerer
 * auto-træk. Alt andet giver default (Automatisk).
 */
export function restoreStoredChoice(
  stored: StoredPrepaidChoice | null | undefined,
  clientId: string | null,
  sessionStart: string | null,
): PrepaidChoice {
  if (
    stored?.choice &&
    clientId !== null &&
    stored.clientId === clientId &&
    stored.sessionStart === sessionStart
  ) {
    return stored.choice;
  }
  return { mode: "auto" };
}

const copenhagenDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Copenhagen",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function copenhagenDayNumber(instant: Date): number {
  const parts: Record<string, number> = {};
  for (const p of copenhagenDate.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000;
}

const copenhagenShortDate = () =>
  dateFormat({
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Kortets udløbsdato som "30. sep. 2026" (BRAND.md) i dansk tid — samme dag som `daysUntilPrepaidExpiry` regner med. */
export function formatPrepaidExpiryDate(expiresAt: string): string {
  return copenhagenShortDate().format(new Date(expiresAt));
}

/**
 * Hele danske kalenderdage til kortets udløbsdato: 0 = udløber i dag (kortet
 * gælder hele udløbsdagen), negativ = udløbet. null = intet udløb.
 *
 * Spejler `prepaidDaysUntilExpiry` i src/lib/prepaid/expiry.ts (#736) —
 * extensionen kan ikke importere fra web-appen.
 */
export function daysUntilPrepaidExpiry(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!expiresAt) return null;
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return null;
  return copenhagenDayNumber(expiry) - copenhagenDayNumber(now);
}

/** Udløber kortet i dag eller inden for `withinDays` dage? */
export function isPrepaidExpiringSoon(
  expiresAt: string | null | undefined,
  withinDays = 7,
  now: Date = new Date(),
): boolean {
  const days = daysUntilPrepaidExpiry(expiresAt, now);
  return days !== null && days >= 0 && days <= withinDays;
}
