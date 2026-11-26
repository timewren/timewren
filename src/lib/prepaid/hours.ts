const PREPAID_HOUR_SCALE = 100;

export function roundPrepaidHours(hours: number): number {
  return (
    Math.round((hours + Number.EPSILON) * PREPAID_HOUR_SCALE) /
    PREPAID_HOUR_SCALE
  );
}

export function ceilPrepaidHours(hours: number): number {
  return (
    Math.ceil((hours - Number.EPSILON) * PREPAID_HOUR_SCALE) /
    PREPAID_HOUR_SCALE
  );
}

function snap(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function normalizePrepaidDeductionHours(
  hours: number,
  clipSizeMinutes?: number | null,
): number {
  if (clipSizeMinutes && clipSizeMinutes > 0) {
    // Regnes i minutter og hundrededele af en time med afrunding på 1e-6, så
    // float-støj ikke koster et ekstra klip eller 0,01 t: 6 × 0,4 t er
    // 2,4000000000000004 i float og blev før trukket som 2,41 t.
    let clips = Math.ceil(snap((hours * 60) / clipSizeMinutes));
    // Posteringer gemmes i hundrededele af en time, så 40 min står som
    // 0,67 t (40,2 min). Ét klip færre dækker posteringen, hvis det afrundet
    // til hundrededele når op på den: 0,67 t er to klip på 20 min, ikke tre.
    // Reglen måler mod den gemte værdi, så trækket ved oprettelse (rå timer
    // fra fx udvidelsen) er det samme som ved en senere genberegning. Begge
    // afrundinger giver tilsammen højst 0,6 min, og klip er mindst 1 min, så
    // der flyttes højst ét klip.
    if (
      clips > 1 &&
      roundPrepaidHours(((clips - 1) * clipSizeMinutes) / 60) >=
        roundPrepaidHours(hours)
    ) {
      clips -= 1;
    }
    return (
      Math.ceil(snap((clips * clipSizeMinutes * PREPAID_HOUR_SCALE) / 60)) /
      PREPAID_HOUR_SCALE
    );
  }
  return roundPrepaidHours(hours);
}

/**
 * Restsaldo når kortets total rettes. Null når den nye total ligger under
 * det allerede brugte: prod har en CHECK (`check_hours_consistency`), der
 * kræver used + remaining = total, så skrivningen ville ellers fejle som en
 * 500 i stedet for en forståelig besked.
 */
export function remainingAfterTotalChange(
  totalHours: number,
  usedHours: number,
): number | null {
  const total = roundPrepaidHours(totalHours);
  const used = roundPrepaidHours(usedHours);
  if (total < used) return null;
  return roundPrepaidHours(total - used);
}
