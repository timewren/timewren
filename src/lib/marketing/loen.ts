/**
 * Løn- og timeprisberegninger til /timeloen-beregner og
 * /timepris-haandvaerker. Rene funktioner uden afhængigheder, så formlerne
 * kan unit-testes og bruges ens i UI og tekst.
 */

/** Uger pr. måned i gennemsnit: 52 ÷ 12. */
export const UGER_PR_MAANED = 52 / 12;

/** Timer pr. måned ved en given ugentlig arbejdstid (37 t → 160,33 t). */
export function timerPrMaaned(timerPrUge: number): number {
  return timerPrUge > 0 ? timerPrUge * UGER_PR_MAANED : 0;
}

/** Månedsløn ÷ timer pr. måned. null når timetallet er 0. */
export function maanedsloenTilTimeloen(
  maanedsloen: number,
  timerPrUge: number,
): number | null {
  const timer = timerPrMaaned(timerPrUge);
  return timer > 0 ? maanedsloen / timer : null;
}

/** Timeløn × timer pr. måned. */
export function timeloenTilMaanedsloen(
  timeloen: number,
  timerPrUge: number,
): number {
  return timeloen * timerPrMaaned(timerPrUge);
}

export interface HaandvaerkerTimeprisInput {
  /** Medarbejderens timeløn i kr. */
  timeloen: number;
  /** Lønomkostninger oven i timelønnen i procent (pension, feriepenge, SH m.m.). */
  loentillaegPct: number;
  /** Betalte timer pr. medarbejder pr. år. */
  betalteTimerPrAar: number;
  /** Andel af de betalte timer, der kan faktureres, i procent. */
  fakturerbarAndelPct: number;
  /** Faste omkostninger pr. medarbejder pr. år (bil, værktøj, forsikring, kontor). */
  fasteOmkostningerPrAar: number;
  /** Avance (pålæg) på kostprisen i procent. */
  avancePct: number;
}

export interface HaandvaerkerTimeprisResultat {
  /** Lønomkostning pr. betalt time inkl. tillæg. */
  loenomkostningPrTime: number;
  /** Fakturerbare timer pr. år. */
  fakturerbareTimer: number;
  /** Løn fordelt på de fakturerbare timer. */
  loenPrFakturerbarTime: number;
  /** Faste omkostninger fordelt på de fakturerbare timer. */
  fastePrFakturerbarTime: number;
  /** Kostpris pr. fakturerbar time: løn + faste. */
  kostprisPrTime: number;
  /** Timepris ekskl. moms: kostpris × (1 + avance). */
  timeprisEksMoms: number;
  /** Timepris inkl. 25 % moms. */
  timeprisInklMoms: number;
  /** Avance i procent af timeprisen: (timepris − kostpris) ÷ timepris. */
  avanceAfTimepris: number | null;
}

/**
 * Timepris for en håndværkertime regnet fra omkostningssiden. Lønnen
 * betales for alle timer, men kun de fakturerbare kan sendes videre til
 * kunden, så både løn og faste omkostninger fordeles på dem. null når der
 * ikke er nogen fakturerbare timer.
 */
export function beregnHaandvaerkerTimepris(
  input: HaandvaerkerTimeprisInput,
): HaandvaerkerTimeprisResultat | null {
  const andel = input.fakturerbarAndelPct / 100;
  const fakturerbareTimer = input.betalteTimerPrAar * andel;
  if (andel <= 0 || fakturerbareTimer <= 0) return null;

  const loenomkostningPrTime =
    input.timeloen * (1 + input.loentillaegPct / 100);
  const loenPrFakturerbarTime = loenomkostningPrTime / andel;
  const fastePrFakturerbarTime =
    input.fasteOmkostningerPrAar / fakturerbareTimer;
  const kostprisPrTime = loenPrFakturerbarTime + fastePrFakturerbarTime;
  const timeprisEksMoms = kostprisPrTime * (1 + input.avancePct / 100);

  return {
    loenomkostningPrTime,
    fakturerbareTimer,
    loenPrFakturerbarTime,
    fastePrFakturerbarTime,
    kostprisPrTime,
    timeprisEksMoms,
    timeprisInklMoms: timeprisEksMoms * 1.25,
    avanceAfTimepris:
      timeprisEksMoms > 0
        ? ((timeprisEksMoms - kostprisPrTime) / timeprisEksMoms) * 100
        : null,
  };
}
