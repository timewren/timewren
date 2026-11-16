/**
 * Nøgletal til de gratis beregnere /daekningsgrad-beregner og
 * /belaegningsgrad-beregner. Rene funktioner uden afhængigheder, så
 * formlerne kan unit-testes og bruges ens i UI og tekst.
 */

export interface DaekningsResultat {
  /** Dækningsbidrag i kr: omsætning − variable omkostninger. */
  daekningsbidrag: number;
  /** Dækningsgrad i procent: DB ÷ omsætning × 100. null ved 0 omsætning. */
  daekningsgrad: number | null;
  /** Resultat før skat: DB − faste omkostninger. */
  resultat: number;
  /** Omsætning hvor resultatet er 0. null når DG ≤ 0. */
  nulpunktsomsaetning: number | null;
}

export function beregnDaekning(input: {
  omsaetning: number;
  variableOmkostninger: number;
  fasteOmkostninger: number;
}): DaekningsResultat {
  const { omsaetning, variableOmkostninger, fasteOmkostninger } = input;
  const daekningsbidrag = omsaetning - variableOmkostninger;
  const daekningsgrad =
    omsaetning > 0 ? (daekningsbidrag / omsaetning) * 100 : null;
  return {
    daekningsbidrag,
    daekningsgrad,
    resultat: daekningsbidrag - fasteOmkostninger,
    nulpunktsomsaetning:
      daekningsgrad !== null && daekningsgrad > 0
        ? fasteOmkostninger / (daekningsgrad / 100)
        : null,
  };
}

/**
 * Salgspris der giver en ønsket dækningsgrad: kostpris ÷ (1 − DG).
 * Fx kostpris 450 kr/t og 40 % DG → 750 kr/t. null ved DG ≥ 100 %.
 */
export function prisForDaekningsgrad(
  kostpris: number,
  oensketDaekningsgradPct: number,
): number | null {
  if (oensketDaekningsgradPct >= 100 || oensketDaekningsgradPct < 0)
    return null;
  return kostpris / (1 - oensketDaekningsgradPct / 100);
}

export interface BelaegningsResultat {
  /** Timer til rådighed om året: normtid × arbejdsuger. */
  disponibleTimer: number;
  /** Fakturerbare timer om året. */
  fakturerbareTimer: number;
  /** Belægningsgrad i procent: fakturerbare ÷ disponible × 100. */
  belaegningsgrad: number | null;
  /** Omsætning om året ved den angivne timepris. */
  omsaetning: number;
  /** Ekstra omsætning pr. procentpoint højere belægningsgrad. */
  vaerdiPrProcentpoint: number;
}

export function beregnBelaegning(input: {
  normtidPrUge: number;
  fravaersuger: number;
  fakturerbareTimerPrUge: number;
  timepris: number;
}): BelaegningsResultat {
  const arbejdsuger = Math.max(0, 52 - input.fravaersuger);
  const disponibleTimer = input.normtidPrUge * arbejdsuger;
  const fakturerbareTimer = input.fakturerbareTimerPrUge * arbejdsuger;
  return {
    disponibleTimer,
    fakturerbareTimer,
    belaegningsgrad:
      disponibleTimer > 0 ? (fakturerbareTimer / disponibleTimer) * 100 : null,
    omsaetning: fakturerbareTimer * input.timepris,
    vaerdiPrProcentpoint: (disponibleTimer / 100) * input.timepris,
  };
}

/** Belægningsgrad der skal til for at nå en omsætning. null uden timer/pris. */
export function belaegningForOmsaetning(input: {
  maalOmsaetning: number;
  disponibleTimer: number;
  timepris: number;
}): number | null {
  if (input.disponibleTimer <= 0 || input.timepris <= 0) return null;
  return (input.maalOmsaetning / input.timepris / input.disponibleTimer) * 100;
}

/**
 * Læser et tal skrevet på dansk eller engelsk: "1.234,5", "1.200", "37,5" og
 * "12.5" giver 1234,5, 1200, 37,5 og 12,5. Negative og ugyldige værdier
 * giver 0, så beregnerne aldrig viser NaN.
 */
export function parseDanskTal(v: string): number {
  const s = v.trim().replace(/\s/g, "");
  let normal: string;
  if (s.includes(",")) normal = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) normal = s.replace(/\./g, "");
  else normal = s;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
