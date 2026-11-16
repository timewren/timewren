import i18n from "i18next";

/**
 * Format seconds as HH:MM:SS.
 */
export function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return (
    h.toString().padStart(2, "0") +
    ":" +
    m.toString().padStart(2, "0") +
    ":" +
    s.toString().padStart(2, "0")
  );
}

/**
 * Format seconds as human-readable duration (e.g. "1t 45m" or "1h 45m").
 * Uses the active i18n language.
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) {
    return i18n.t("common.durationH", { h, m });
  }
  return i18n.t("common.durationM", { m });
}

/**
 * Format ISO timestamp as HH:MM time string.
 */
export function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

/**
 * Format ISO timestamp as human-readable date (e.g. "18. feb 2026" / "Feb 18, 2026").
 * Uses the active i18n language.
 */
export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const shortMonths = i18n.t("calendar.shortMonthNames", {
    returnObjects: true,
  }) as string[];
  if (i18n.language === "en") {
    return `${shortMonths[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  }
  return `${date.getDate()}. ${shortMonths[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Format an amount in Danish kroner in the *active* language.
 *
 * Beløbene stod før som `amount.toLocaleString("da-DK")` efterfulgt af en
 * `kr.` der lå i markup'en. Det gav en tysk bruger dansk tusindtalsseparator
 * (`1.234,50`) og en svensk ét tusindstallet med et blødt mellemrum skrevet som
 * "kr." på dansk — altså dansk talformat oven på tysk tekst, præcis som
 * `formatSyncTime` havde det med datoer.
 *
 * `Intl` løser begge dele: separator, decimaltegn *og* valutasymbolets placering
 * følger det valgte sprog. Symbolet er ikke en konstant — engelsk skriver
 * "DKK 1,234.50", tysk "1.234,50 DKK" og dansk "1.234,50 kr.".
 *
 * `maximumFractionDigits: 3` er ikke en vilje, men bevarelse. `style: "currency"`
 * har i sig selv `maximumFractionDigits: 2`, så uden denne linje **rundede** denne
 * funktion beløb, mens den forrige `toLocaleString("da-DK", {
 * minimumFractionDigits: 2 })` ikke gjorde det: `0,005` blev "0,01 kr." i stedet
 * for "0,005 kr.". I `InvoiceEditor` summerer `subtotal` det *uafrundede*
 * `line.amount`, så beløbskolonnen og totalen holdt op at være hinandens sum.
 * En faktura skal kunne afstemmes, så vi bevarer de tre decimaler.
 *
 * `decimals` låser begge tal til samme antal steder, som det beløb der skal
 * afstemmes mod. Rapportens momstabel (`ReportView`) viste præcis to decimaler
 * og skrev så " kr" ved siden af, så den havde sin egen `formatKrPrecise` med
 * hårdkodet `da-DK`. Den bruger denne nu — så tallet *og* symbolets placering
 * følger sprogvalget, i stedet for at kun decimalerne gør det.
 */
export function formatCurrency(amount: number, decimals?: number): string {
  return new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "DKK",
    minimumFractionDigits: decimals ?? 2,
    maximumFractionDigits: decimals ?? 3,
  }).format(amount);
}

/**
 * Timer med én decimal — samme løsning som `formatCurrency`: decimaltegnet og
 * tusindtallet følger det valgte sprog (`2,5` på dansk, svensk, norsk og tysk,
 * `2.5` på engelsk). Koden skrev decimaltegnet selv med `.replace(".", ",")`,
 * hvilket gav dansk talformat oven på svensk, norsk og engelsk tekst.
 *
 * `decimals` er **maksimum**, og `minimumDecimals` låser bunden. De to steder,
 * hvor tallet læses som en del af en sætning eller som en akse-etiket, vil
 * hellere skrive "6" end "6,0" — de beder om `minimumDecimals: 0`. Resten af
 * `formatHours` låser begge til 1, fordi en fakturasummer skal kunne afstemmes
 * mod de enkelte linjers timer: den må hverken miste `.0` (én hel time) eller
 * få to (som ikke kan lægges sammen med det øvrige regneark).
 */
export function formatHours(
  hours: number,
  decimals = 1,
  minimumDecimals = decimals,
): string {
  return new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: minimumDecimals,
    maximumFractionDigits: decimals,
  }).format(hours);
}

/**
 * Et tal uden enhed — momssatsen i rapportens momstabel, for eksempel.
 *
 * Samme `Intl` som `formatCurrency`, uden valuta: `Intl` skriver en sats med
 * et mellemrum og symbolet i hvert sit sprog, men tallet for sig selv skal
 * følge sprogvalget, og kaldet skal hedde det, der sker.
 *
 * `decimals` er **maksimum** og `minimumDecimals` bunden, som i `formatHours`.
 * Det er ikke en kosmetisk detalje: momssatsen beregnes i Rust med det
 * *uaf rundede* tal (`grundlag * vat_rate / 100.0`), så `7,5` i tabellen ved
 * siden af et beløb beregnet med 7,5 er sandt, mens «8 %» er en påstand
 * appen ikke kan holde. Rapporten beder derfor om `(2, 0)`: 25 skriver «25»,
 * 7,5 skriver «7,5».
 */
export function formatNumber(
  value: number,
  decimals = 0,
  minimumDecimals = decimals,
): string {
  return new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: minimumDecimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Convert a Date to local YYYY-MM-DD string.
 * IMPORTANT: Uses getFullYear/getMonth/getDate — never .toISOString()
 * which converts to UTC and shifts dates in CET timezone.
 */
export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Convert a Date to a local wall-clock timestamp: `YYYY-MM-DDTHH:MM:SS`.
 *
 * This is the exact form `time_entries.start_time` and `end_time` store, and
 * the one `resolveEntryTimes` builds for the manual form — so the whole app
 * writes one shape. `toISOString()` writes UTC with a `Z`, which is the *other*
 * shape the column historically held, and the reason a registration between
 * midnight and 02:00 landed on the previous calendar day: every reader of the
 * column treats it as a local wall clock.
 *
 * No offset is appended, deliberately. A value *with* an offset invites the
 * reader to convert it a second time, and the one reader that understands both
 * — Rust's `tid::lokal_naiv` — does exactly that.
 */
export function toLocalDateTimeStr(date: Date): string {
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((v) => v.toString().padStart(2, "0"))
    .join(":");
  return `${toLocalDateStr(date)}T${time}`;
}
