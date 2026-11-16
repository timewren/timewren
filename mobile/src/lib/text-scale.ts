/**
 * Systemskrift og pladsering.
 *
 * Der står ingen `allowFontScaling={false}` i `src/`, så al `Text` skalerer
 * med systemets skriftstørrelse — det er godt. Men en *fast højde* på en
 * knap holder ikke: teksten vokser, højden gør ikke, og etikken bliver klippet
 * væk i top og bund. En knap uden læselig tekst kan ikke bruges, og "Gem
 * ændringer" der viser "Gem æ…inger" er dødsens for en app om tidsregistrering.
 *
 * Derfor vokser højden med skriften. Væksten *klemmes* ved `MAX_GROWTH`:
 * uden klem ville en knap på Androids største indstilling blive højere end
 * skærmen er bred og skubbe indholdet ud af vejen for alt andet. 1,6 giver
 * plads til den tekst, der bliver ved de indstillinger, folk faktisk bruger.
 *
 * Ved `fontScale = 1` (default på alle telefoner) er resultatet præcis
 * grundhøjden, så intet på skærmen rykker sig for den, der ikke har bedt om
 * en større skrift.
 */

/** Så meget må pladseringen højst vokse med skriften. */
export const MAX_GROWTH = 1.6;

/**
 * Mindste højde et element med tekst i bør have ved en given system-skrift.
 *
 * Kun til de steder, der i dag har en fast højde (`h-11`, `h-12`, …). Resultatet
 * bruges som `minHeight`, så det aldrig kan gøre et element *mindre* — en
 * knap der er højere fordi kaldes `h-14`, beholder sin højde.
 */
export function textSafeHeight(baseHeight: number, fontScale: number): number {
  if (!Number.isFinite(baseHeight) || baseHeight <= 0)
    return baseHeight;
  // Klemmer begge veje: en *mindre* system-skrift må ikke gøre knappen mindre
  // end den 44 px høje touch-flate den har i dag.
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? Math.min(Math.max(fontScale, 1), MAX_GROWTH) : 1;
  return Math.round(baseHeight * scale);
}
