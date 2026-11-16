const WEEKS_PER_YEAR = 52;

/**
 * Beregner det årlige tab på ikke-fakturerbar tid.
 *
 * Bruges af landing-page beregneren til at vise freelancere hvor meget de
 * taber på transport, småjusteringer, administration m.v. der aldrig faktureres.
 */
export function calculateYearlyHiddenCost(
  hourlyRate: number,
  unbilledHoursPerWeek: number,
): number {
  return Math.round(hourlyRate * unbilledHoursPerWeek * WEEKS_PER_YEAR);
}
