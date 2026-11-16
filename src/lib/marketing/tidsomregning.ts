/**
 * Omregning mellem minutter, timer:minutter og decimaltimer (100-dele) til
 * /minutter-til-timer. Rene funktioner, så tabellen på siden og beregneren
 * bruger præcis samme afrunding.
 */

/** Minutter → decimaltimer, afrundet til 2 decimaler (fx 45 → 0,75). */
export function minutterTilDecimal(minutter: number): number {
  if (!Number.isFinite(minutter) || minutter <= 0) return 0;
  return Math.round((minutter / 60) * 100) / 100;
}

/** Decimaltimer → hele timer og minutter (fx 2,3 → 2 t 18 min). */
export function decimalTilTimerOgMinutter(decimal: number): {
  timer: number;
  minutter: number;
} {
  if (!Number.isFinite(decimal) || decimal <= 0)
    return { timer: 0, minutter: 0 };
  const total = Math.round(decimal * 60);
  return { timer: Math.floor(total / 60), minutter: total % 60 };
}

/**
 * Den typiske fejl: timer og minutter skrevet med komma, så 1 t 45 min
 * bliver til "1,45" i stedet for 1,75.
 */
export function forkertKommaTimer(totalMinutter: number): number {
  if (!Number.isFinite(totalMinutter) || totalMinutter <= 0) return 0;
  const t = Math.round(totalMinutter);
  const hele = Math.floor(t / 60);
  const rest = t % 60;
  return hele + rest / 100;
}

/** Dansk talformat med præcis to decimaler, fx 7,40. */
export function formatDecimaltimer(timer: number): string {
  return timer.toLocaleString("da-DK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
