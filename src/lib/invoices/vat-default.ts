/**
 * "Jeg er momsregistreret" slås til af sig selv, når en dansk virksomhed
 * får et CVR-nummer (Mads 22/11-26). Uden CVR forbliver den slået fra, og
 * et valg brugeren selv har truffet, røres ikke. Reglen bruges både i
 * formularerne (indstillinger og onboarding), så brugeren ser fluebenet
 * blive sat, og på serveren, når et kald udelader `vatRegistered`.
 *
 * Om brugeren har valgt, står i `company_profiles.vat_registered_chosen`
 * (0163). Det afgøres kun af, om et kald har sendt `vatRegistered`, aldrig
 * af mellemliggende autogemte værdier som et halvt CVR-nummer. Indtil
 * brugeren vælger, følger fluebenet alene landet og CVR-nummeret, som de
 * står nu, så det også slås til igen, når landet bliver dansk igen.
 */

const DANISH_COUNTRY = /^(danmark|denmark|dänemark|dk)$/i;

/** Tomt land tæller som Danmark (feltets standard er "Danmark"). */
export function isDanishCountry(country: string | null | undefined): boolean {
  const value = (country ?? "").trim();
  return value === "" || DANISH_COUNTRY.test(value);
}

/** Et dansk CVR-nummer: 8 cifre, gerne med mellemrum eller "DK" foran. */
export function isDanishCvr(cvrNumber: string | null | undefined): boolean {
  const digits = (cvrNumber ?? "").replace(/\s+/g, "").replace(/^dk/i, "");
  return /^\d{8}$/.test(digits);
}

export interface VatDecisionInput {
  /** Brugerens valg i dette kald; udeladt = intet valg. */
  requested?: boolean;
  /** Har brugeren valgt før (det gemte flag, eller fluebenet er rørt nu)? */
  chosen: boolean;
  /** Den gemte værdi. Bruges kun, når brugeren har valgt. */
  stored: boolean | null | undefined;
  /** CVR-nummer og land, som de står nu. */
  cvrNumber: string | null | undefined;
  country: string | null | undefined;
}

export interface VatDecision {
  vatRegistered: boolean;
  vatRegisteredChosen: boolean;
}

/**
 * Værdien der vises og gemmes. Brugerens eget valg vinder altid; ellers er
 * fluebenet slået til, præcis når en dansk virksomhed har et helt CVR.
 */
export function decideVat({
  requested,
  chosen,
  stored,
  cvrNumber,
  country,
}: VatDecisionInput): VatDecision {
  if (requested !== undefined) {
    return { vatRegistered: requested, vatRegisteredChosen: true };
  }
  if (chosen) {
    return { vatRegistered: stored === true, vatRegisteredChosen: true };
  }
  return {
    vatRegistered: isDanishCountry(country) && isDanishCvr(cvrNumber),
    vatRegisteredChosen: false,
  };
}
