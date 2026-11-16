import i18n from "i18next";
import { formatHours, formatNumber } from "@/lib/format";

/**
 * Den advarsel, der dukker op når et klippekort er ved at løbe tør.
 *
 * Rust sender **tal**, ikke en sætning, og det er her den bliver til tekst.
 * Det er ikke en udsmykning: den gamle vej skrev beskeden i Rust med
 * `format!("Klippekort er {:.0}% brugt ({:.1}t / {:.1}t)")`, så en svensk, norsk,
 * tysk eller engelsk bruger fik dansk midt i en oversat app — og `{:.1}` skrev
 * decimalkommaet som et **punkt** i alle sprog, så selv dansk læste «29.5t / 30t».
 * `formatHours` bruger samme `Intl` som resten af appen (K25f), så tal, tegn og
 * ord rækkefølge følger det sprog brugeren har valgt.
 *
 * Udskilt fra `main.tsx`s `listen`-kald, fordi en test skal kunne dømme teksten
 * i fem sprog uden at starte appen: `main.tsx` kalder `ReactDOM.render` ved
 * import, så et kald til den dømmer opsætningen og ikke beskeden.
 */

/** Payloaden Rust sender på `klippekort-warning`. */
export interface KlippekortAdvarsel {
  type: string;
  used: number;
  total: number;
}

export function klippekortAdvarselTekst(a: KlippekortAdvarsel): string {
  const brugt = formatHours(a.used, 1, 0);
  const total = formatHours(a.total, 1, 0);

  if (a.type === "depleted") {
    return i18n.t("klippekort.warningDepleted", { used: brugt, total });
  }

  // Procenten tager `formatNumber`, som runder med samme regel som tallene ovenfor.
  // Der stod en `Math.round` her, og målinger over 80.400 realistiske
  // `brugt/total`-par fandt **nul** steder hvor de to er uenige — også på de
  // halve tal (`47,5 → 48`), fordi `Intl` runder halve op ligesom `Math.round`.
  // Den var altså kode uden opgave, som ingen port kunne dømme, så den er væk.
  //
  // `total <= 0` kan ikke komme fra en korrekt database (Rust værter for det), men
  // uden værnet ville divisionen give `Infinity`, som `Intl` skriver som «∞» — og
  // «Klippekortet er ∞ % brugt» er en påstand, ingen kan bruge.
  const pct = a.total > 0 ? (a.used / a.total) * 100 : 0;
  return i18n.t("klippekort.warningNearly", {
    pct: formatNumber(pct),
    used: brugt,
    total,
  });
}

/** Toastens niveau: et opbrugt klippekort er en fejl, et næsten opbrugt en info. */
export function klippekortAdvarselNiveau(type: string): "error" | "info" {
  return type === "depleted" ? "error" : "info";
}
