import { numberFormat, t } from "../i18n/core";
/**
 * Kopi af src/components/klippekort/huller-model.ts (web), så popup og ny
 * fane viser klippekortet som huller efter samme regler som appen og
 * kundeportalen. Extensionens bundle holdes fri af importer fra web-appens
 * src/, så modellen er kopieret; klippekort-huller-parity.test.ts låser, at
 * de to giver samme resultat. Ret begge steder.
 *
 * Regnemodellen bag klippekortets huller (docs/BRAND.md → Klippekortet:
 * regler). Ren funktion uden React, så reglerne kan testes.
 *
 * - 1 hul = 1 time op til 20 timer.
 * - Over 20 timer: 1 hul = 5 timer, med en note ("1 hul = 5 t").
 * - Brugte timer er udfyldte huller; en rest under et helt hul vises som
 *   et halvfyldt hul.
 * - Saldoen formuleres altid som det, der er tilbage ("7 t tilbage af 20").
 * - Meget store kort (over MAX_HOLES huller) vises som bjælke.
 */

export type HulTilstand = "brugt" | "halv" | "tom";

export const HOURS_PER_HOLE_SMALL = 1;
export const HOURS_PER_HOLE_LARGE = 5;
export const SMALL_CARD_MAX_HOURS = 20;
/** Over 40 huller (kort på mere end 200 t) falder visningen tilbage til bjælke. */
export const MAX_HOLES = 40;

export interface KlippekortModel {
  totalHours: number;
  remainingHours: number;
  usedHours: number;
  overdraftHours: number;
  hoursPerHole: number;
  holes: HulTilstand[];
  /** true, når kortet er for stort til huller og skal vises som bjælke. */
  useBar: boolean;
  /** Andel brugt, 0-1 (til bjælke-fallback). */
  usedFraction: number;
  /** "1 hul = 5 t" eller null. */
  note: string | null;
  /** Tilgængelig tekst, fx "7 t tilbage af 20". */
  label: string;
}

const nf = () => numberFormat({ maximumFractionDigits: 2 });

/** Danske decimaler: 7,5 og 2,25. */
export function formatTimer(hours: number): string {
  return nf().format(hours);
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

export function klippekortModel(
  totalHoursInput: number,
  remainingHoursInput: number,
): KlippekortModel {
  const totalHours = Math.max(0, finite(totalHoursInput));
  const rawRemaining = finite(remainingHoursInput);
  const remainingHours = Math.min(Math.max(rawRemaining, 0), totalHours);
  const overdraftHours = rawRemaining < 0 ? -rawRemaining : 0;
  const usedHours = totalHours - remainingHours;

  const hoursPerHole =
    totalHours > SMALL_CARD_MAX_HOURS
      ? HOURS_PER_HOLE_LARGE
      : HOURS_PER_HOLE_SMALL;
  // Afrund for at undgå flydende-komma-støj (fx 20.000000001 t).
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const holeCount = Math.ceil(round(totalHours / hoursPerHole));
  const used = round(usedHours);

  // Hvert hul dækker [start, slut); det sidste kan være kortere end et helt
  // hul (fx 0,5 t på et kort på 7,5 t), så et opbrugt kort er helt udfyldt.
  const useBar = holeCount > MAX_HOLES;
  const holes: HulTilstand[] = useBar
    ? []
    : Array.from({ length: holeCount }, (_, i) => {
        const start = i * hoursPerHole;
        const end = Math.min((i + 1) * hoursPerHole, totalHours);
        if (used >= round(end)) return "brugt";
        if (used > round(start)) return "halv";
        return "tom";
      });

  let label = t("prepaid.label", {
    remaining: formatTimer(remainingHours),
    total: formatTimer(totalHours),
  });
  if (overdraftHours > 0) {
    label += `, ${t("prepaid.overdrawn", { hours: formatTimer(overdraftHours) })}`;
  }

  return {
    totalHours,
    remainingHours,
    usedHours,
    overdraftHours,
    hoursPerHole,
    holes,
    useBar,
    usedFraction: totalHours > 0 ? usedHours / totalHours : 0,
    note:
      hoursPerHole === HOURS_PER_HOLE_SMALL
        ? null
        : t("prepaid.note", { hours: formatTimer(hoursPerHole) }),
    label,
  };
}
