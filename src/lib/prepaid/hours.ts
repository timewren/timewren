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

export function normalizePrepaidDeductionHours(
  hours: number,
  clipSizeMinutes?: number | null,
): number {
  if (clipSizeMinutes && clipSizeMinutes > 0) {
    const clipSizeHours = clipSizeMinutes / 60;
    return ceilPrepaidHours(Math.ceil(hours / clipSizeHours) * clipSizeHours);
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
