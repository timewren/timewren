/**
 * Organisationens valuta, land og sprog (fund 11, 18 og 19 i
 * docs/research/2026-11-22-foerste-oplevelse.md).
 *
 * Afgøres én gang, når arbejdsområdet oprettes, ud fra ejerens sprog, og
 * gemmes i organizations.metadata (ingen migration). TimeTrack er dansk og
 * får altid DKK og Danmark; en ny TimeWren-bruger på engelsk, tysk eller
 * spansk får EUR. Organisationer fra før har ingen felter og læses som DKK
 * og Danmark, præcis som før.
 *
 * Client-safe: ingen DB-imports.
 */

import { parseOrgMetadata } from "@/lib/utils/org-metadata";

/** Valutaer appen kan vise beløb i (se src/lib/demo/currency-messages.ts). */
export type OrgCurrency = "DKK" | "EUR";

export interface OrgRegion {
  currency: OrgCurrency;
  /** ISO 3166-1 alpha-2. null: sproget siger ikke noget om landet (engelsk). */
  country: string | null;
  /** Sproget ved oprettelsen. null for organisationer oprettet før feltet. */
  locale: string | null;
}

export const DEFAULT_ORG_REGION: OrgRegion = {
  currency: "DKK",
  country: "DK",
  locale: null,
};

const COUNTRY_BY_LANGUAGE: Record<string, string> = {
  da: "DK",
  de: "DE",
  es: "ES",
};

function language(locale: string | null | undefined): string {
  return (locale || "da").toLowerCase().split(/[-_]/)[0];
}

/**
 * Valuta, land og sprog for en ny organisation. `locale` er ejerens sprog
 * (users.locale); uden et sprog er appen dansk (kolonnens default).
 */
export function regionForNewOrg(
  brand: "timetrack" | "timewren",
  locale: string | null | undefined,
): OrgRegion {
  const lang = language(locale);
  if (brand === "timetrack") {
    return { currency: "DKK", country: "DK", locale: lang };
  }
  return {
    currency: lang === "da" ? "DKK" : "EUR",
    country: COUNTRY_BY_LANGUAGE[lang] ?? null,
    locale: lang,
  };
}

/**
 * Læser regionen fra organizations.metadata; manglende felter = som før.
 * Better-Auth gemmer metadata som JSON-streng, når organisationen opdateres
 * (fx tilladte domæner), så begge former læses.
 */
export function orgRegionFromMetadata(metadata: unknown): OrgRegion {
  const m: Record<string, unknown> = parseOrgMetadata(metadata);
  const currency: OrgCurrency = m.currency === "EUR" ? "EUR" : "DKK";
  let country: string | null;
  if (typeof m.country === "string") country = m.country;
  else if ("country" in m || currency === "EUR") country = null;
  else country = "DK";
  return {
    currency,
    country,
    locale: typeof m.locale === "string" ? m.locale : null,
  };
}

/** Felterne, der skrives i organizations.metadata ved oprettelsen. */
export function regionMetadata(region: OrgRegion): Record<string, unknown> {
  return {
    currency: region.currency,
    country: region.country,
    locale: region.locale,
  };
}

/**
 * Præfikset på rigtige fakturanumre. En dansk organisation oprettet efter
 * runde 2 får løbenumre uden præfiks ("1", "2", …), som i Billy, Dinero og
 * e-conomic. Alle andre, og alle organisationer fra før, beholder "INV-".
 */
export function invoiceNumberPrefix(region: OrgRegion): string {
  return region.locale === "da" ? "" : "INV-";
}

/** Fakturanummer nummer `n` i organisationens serie. */
export function formatInvoiceSequence(region: OrgRegion, n: number): string {
  const prefix = invoiceNumberPrefix(region);
  return prefix ? `${prefix}${String(n).padStart(3, "0")}` : String(n);
}

/** Navne på Danmark, som en bruger kan skrive i kundens landefelt. */
const DENMARK_NAMES = new Set([
  "dk",
  "danmark",
  "denmark",
  "dänemark",
  "daenemark",
  "dinamarca",
]);

export function isDenmark(country: string | null | undefined): boolean {
  return DENMARK_NAMES.has((country ?? "").trim().toLowerCase());
}

/** EU-landene ud over Danmark (ISO 3166-1 alpha-2). */
const EU_COUNTRY_CODES = [
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
];

/** Sprog, landenavnene genkendes på (appens sprog). */
const COUNTRY_NAME_LOCALES = [
  "da",
  "en",
  "de",
  "es",
  "fr",
  "it",
  "nl",
  "sv",
  "nb",
  "fi",
  "pl",
  "pt",
  "cs",
];

/** Navne, Intl ikke giver, men som brugere skriver. */
const EU_COUNTRY_ALIASES = [
  "el",
  "czech republic",
  "holland",
  "the netherlands",
  "republic of ireland",
];

function foldCountry(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

let euCountryNames: Set<string> | null = null;

function euNames(): Set<string> {
  if (euCountryNames) return euCountryNames;
  const names = new Set<string>(EU_COUNTRY_ALIASES);
  for (const code of EU_COUNTRY_CODES) {
    names.add(code.toLowerCase());
    for (const locale of COUNTRY_NAME_LOCALES) {
      try {
        const name = new Intl.DisplayNames([locale], { type: "region" }).of(
          code,
        );
        if (name) names.add(foldCountry(name));
      } catch {
        // Sproget findes ikke i denne Intl; koderne og de andre sprog dækker.
      }
    }
  }
  euCountryNames = names;
  return names;
}

/**
 * Ligger landet i EU uden for Danmark? Kundens landefelt er fri tekst, så
 * ISO-koden og navnet på appens sprog genkendes ("Tyskland", "Germany",
 * "Deutschland", "DE"). Tomt eller ukendt land: false.
 */
export function isEuMemberState(country: string | null | undefined): boolean {
  const key = foldCountry(country ?? "");
  return key !== "" && euNames().has(key);
}

/** Momsnummer uden mellemrum, punktummer og bindestreger, med versaler. */
export function normalizeVatNumber(value: string): string {
  return value.replace(/[\s.-]/g, "").toUpperCase();
}

/**
 * EU-momsnummerets form (VIES): landekode på to bogstaver og 2-13 tegn.
 * Kun formen tjekkes; om nummeret findes, afgør VIES.
 */
export function isEuVatFormat(value: string): boolean {
  return /^[A-Z]{2}[0-9A-Z+*]{2,13}$/.test(normalizeVatNumber(value));
}

/**
 * Standardværdien i kundens landefelt: "Danmark" for en dansk organisation
 * uanset UI-sproget (som før, og som CVR, e-conomic og DB-default skriver),
 * ellers landets navn på brugerens sprog, tom uden kendt land.
 */
export function defaultClientCountry(
  region: OrgRegion,
  uiLocale: string,
): string {
  if (region.country === "DK") return "Danmark";
  if (!region.country) return "";
  try {
    return (
      new Intl.DisplayNames([uiLocale], { type: "region" }).of(
        region.country,
      ) ?? ""
    );
  } catch {
    return "";
  }
}
