import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";

import {
  formatCurrency,
  formatDate,
  formatDuration,
  formatElapsed,
  formatHours,
  formatNumber,
  formatTime,
  toLocalDateStr,
} from "../format";

/**
 * `formatCurrency` læser det *valgte* sprog, så hver test skifter det. Efter
 * hver test skifter vi tilbage, så rækkefølgen ikke afgør resultatet.
 */
afterEach(async () => {
  await i18n.changeLanguage("da");
});

/**
 * `Intl` sætter U+00A0 mellem tal og symbol. Det er symbolets *placering*, der er
 * pointen i de tests herunder, ikke hvilken slags mellemrum — så det normaliseres
 * væk, ellers ville en ny ICU-version gøre dem røde uden at produktet ændrer sig.
 */
const ryd = (s: string) => s.replaceAll("\u00a0", " ");

describe("formatElapsed", () => {
  it("formats zero seconds", () => {
    expect(formatElapsed(0)).toBe("00:00:00");
  });

  it("formats seconds only", () => {
    expect(formatElapsed(45)).toBe("00:00:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatElapsed(125)).toBe("00:02:05");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatElapsed(3661)).toBe("01:01:01");
  });

  it("formats large values", () => {
    expect(formatElapsed(36000)).toBe("10:00:00");
  });

  it("truncates fractional seconds", () => {
    expect(formatElapsed(59.9)).toBe("00:00:59");
  });
});

describe("formatDuration", () => {
  it("formats zero seconds as 0m", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("formats minutes only", () => {
    expect(formatDuration(1800)).toBe("30m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(6300)).toBe("1t 45m");
  });

  it("formats exact hours", () => {
    expect(formatDuration(7200)).toBe("2t 0m");
  });

  it("ignores remaining seconds", () => {
    expect(formatDuration(3665)).toBe("1t 1m");
  });

  it("formats large durations", () => {
    expect(formatDuration(86400)).toBe("24t 0m");
  });
});

describe("formatTime", () => {
  it("formats morning time", () => {
    // 2026-03-15T08:05:00 local
    const d = new Date(2026, 2, 15, 8, 5, 0);
    expect(formatTime(d.toISOString())).toBe("08:05");
  });

  it("formats midnight", () => {
    const d = new Date(2026, 0, 1, 0, 0, 0);
    expect(formatTime(d.toISOString())).toBe("00:00");
  });

  it("formats afternoon time", () => {
    const d = new Date(2026, 5, 20, 14, 30, 0);
    expect(formatTime(d.toISOString())).toBe("14:30");
  });

  it("formats end of day", () => {
    const d = new Date(2026, 11, 31, 23, 59, 0);
    expect(formatTime(d.toISOString())).toBe("23:59");
  });
});

describe("formatDate", () => {
  it("formats a Danish date", () => {
    const d = new Date(2026, 1, 18, 12, 0, 0); // 18 feb 2026
    expect(formatDate(d.toISOString())).toBe("18. feb 2026");
  });

  it("formats January", () => {
    const d = new Date(2026, 0, 1, 12, 0, 0);
    expect(formatDate(d.toISOString())).toBe("1. jan 2026");
  });

  it("formats May (maj in Danish)", () => {
    const d = new Date(2026, 4, 23, 12, 0, 0);
    expect(formatDate(d.toISOString())).toBe("23. maj 2026");
  });

  it("formats December", () => {
    const d = new Date(2026, 11, 31, 12, 0, 0);
    expect(formatDate(d.toISOString())).toBe("31. dec 2026");
  });

  it("handles single-digit day", () => {
    const d = new Date(2026, 2, 5, 12, 0, 0);
    expect(formatDate(d.toISOString())).toBe("5. mar 2026");
  });
});

describe("toLocalDateStr", () => {
  it("formats a date as YYYY-MM-DD", () => {
    const d = new Date(2026, 1, 18, 0, 0, 0); // 18 feb 2026
    expect(toLocalDateStr(d)).toBe("2026-02-18");
  });

  it("pads single-digit month and day", () => {
    const d = new Date(2026, 0, 5); // 5 jan 2026
    expect(toLocalDateStr(d)).toBe("2026-01-05");
  });

  it("handles end of year", () => {
    const d = new Date(2026, 11, 31);
    expect(toLocalDateStr(d)).toBe("2026-12-31");
  });

  it("uses local date, not UTC — midnight CET stays on same day", () => {
    // This is the critical test: midnight local time should NOT shift to previous day
    const d = new Date(2026, 1, 18, 0, 0, 0); // Midnight Feb 18 local
    expect(toLocalDateStr(d)).toBe("2026-02-18");
    // If we had used .toISOString().split("T")[0], this would fail in CET
  });

  it("handles leap year", () => {
    const d = new Date(2024, 1, 29); // Feb 29 2024 (leap year)
    expect(toLocalDateStr(d)).toBe("2024-02-29");
  });
});

describe("formatCurrency", () => {
  it("runder ikke beløb med tre decimaler væk", async () => {
    // `Intl` med `style: "currency"` har i sig selv `maximumFractionDigits: 2`,
    // så en `minimumFractionDigits: 2` uden et explicit `maximum` fik 0,005 til at
    // blive "0,01". `InvoiceEditor` summerer det *uafrundede* `line.amount`, så
    // kolonnen og totalen holdt op at være hinandens sum på en faktura.
    await i18n.changeLanguage("da");
    expect(ryd(formatCurrency(0.005))).toBe("0,005 kr.");
    expect(ryd(formatCurrency(12.345))).toBe("12,345 kr.");
  });

  it("beholder to decimaler som minimum", async () => {
    await i18n.changeLanguage("da");
    expect(ryd(formatCurrency(1234.5))).toBe("1.234,50 kr.");
    expect(ryd(formatCurrency(0))).toBe("0,00 kr.");
  });

  it("skriver valutaen i det valgte sprog, ikke altid dansk", async () => {
    // Det var hele pointen med `Intl`: engelsk, svensk og tysk placerer
    // symbolet anderledes end dansk.
    await i18n.changeLanguage("en");
    expect(ryd(formatCurrency(1234.5))).toBe("DKK 1,234.50");
    await i18n.changeLanguage("de");
    expect(ryd(formatCurrency(1234.5))).toBe("1.234,50 DKK");
    await i18n.changeLanguage("sv");
    expect(ryd(formatCurrency(1234.5))).toBe("1 234,50 Dkr");
  });

  it("håndterer negative beløb", async () => {
    await i18n.changeLanguage("da");
    expect(ryd(formatCurrency(-1234.5))).toBe("-1.234,50 kr.");
  });
});

describe("formatHours", () => {
  it("skriver decimaltegn i det valgte sprog", async () => {
    // `EntrySelector` skrev decimaltegnet selv med `.replace(".", ",")`, så
    // engelsk læste «2,5 timer». Samme fejl som `formatCurrency` havde, på et
    // andet sted — og de fire øvrige sprog bruger alle komma, så det er
    // engelsk testen kan skelne på.
    await i18n.changeLanguage("da");
    expect(ryd(formatHours(2.5))).toBe("2,5");
    await i18n.changeLanguage("de");
    expect(ryd(formatHours(2.5))).toBe("2,5");
    await i18n.changeLanguage("sv");
    expect(ryd(formatHours(2.5))).toBe("2,5");
    await i18n.changeLanguage("nb");
    expect(ryd(formatHours(2.5))).toBe("2,5");
    await i18n.changeLanguage("en");
    expect(ryd(formatHours(2.5))).toBe("2.5");
  });

  it("beholder nøjagtig én decimal", async () => {
    // En fakturasummer skal kunne afstemmes mod de enkelte linjers timer, så
    // den må hverken miste `.0` (én hel time) eller få to (som ikke kan
    // lægges sammen med det øvrige regneark).
    await i18n.changeLanguage("da");
    expect(ryd(formatHours(1))).toBe("1,0");
    expect(ryd(formatHours(0))).toBe("0,0");
    expect(ryd(formatHours(1 / 3))).toBe("0,3");
  });

  it("låser begge decimaler, når rapporten beder om et bestemt antal", async () => {
    // `ReportView` skrev decimaltegnet selv med `toFixed()`, som altid sætter
    // `.`. Den erstattede det med denne, så et bestemt antal steder låses på
    // begge sider — ellers ville 2,5 blive "3" i en dagssum.
    await i18n.changeLanguage("da");
    expect(ryd(formatHours(2.5, 2))).toBe("2,50");
    expect(ryd(formatHours(2.5, 0))).toBe("3");
    await i18n.changeLanguage("en");
    expect(ryd(formatHours(2.5, 2))).toBe("2.50");
    expect(ryd(formatHours(2.5, 0))).toBe("3");
  });

  it("lader en sætning skrive 6 og ikke 6,0", async () => {
    // Tallene under graferne og på aksen læses som en del af en sætning eller
    // som en kort etiket, så det følger engelsk at skrive "6" — kun den der
    // afstemmer mod et regneark skal have den låste decimal.
    await i18n.changeLanguage("da");
    expect(ryd(formatHours(6, 1, 0))).toBe("6");
    expect(ryd(formatHours(4.8, 1, 0))).toBe("4,8");
    await i18n.changeLanguage("en");
    expect(ryd(formatHours(6, 1, 0))).toBe("6");
    expect(ryd(formatHours(4.8, 1, 0))).toBe("4.8");
  });
});

describe("formatNumber", () => {
  it("skriver en sats i det valgte sprog, uden valuta", async () => {
    // Rapportens momstabel skrev `b.vat_rate.toLocaleString("da-DK")`, så en
    // tysk læser så «25» — hvilket er det samme, men `formatNumber` gør
    // vejen eksplicit for en sats der *kunne* have decimaler. Dansk og tysk
    // bruger begge decimalkomma, så engelsk skelner på separatorerne.
    await i18n.changeLanguage("da");
    expect(formatNumber(25)).toBe("25");
    expect(formatNumber(25.5, 1)).toBe("25,5");
    await i18n.changeLanguage("en");
    expect(formatNumber(25.5, 1)).toBe("25.5");
    await i18n.changeLanguage("sv");
    // Svensk bruger U+00A0 (et blødt mellemrum) som tusindtalsseparator, så
    // den normaliseres væk som i de øvrige tests.
    expect(ryd(formatNumber(1234, 0))).toBe("1 234");
  });

  it("beholder de decimaler, satsen faktisk har", async () => {
    // `decimals` lå fast på begge sider, så rapportens `formatNumber(rate, 0)`
    // skrev «8» for 7,5. Rust beregner momsen med det uaf rundede tal, så
    // tabellen lægte en sats og viste et beløb efter en anden. Samme løsning
    // som `formatHours`: `decimals` er maksimum, `minimumDecimals` er bunden.
    await i18n.changeLanguage("da");
    expect(formatNumber(7.5, 2, 0)).toBe("7,5");
    expect(formatNumber(25, 2, 0)).toBe("25");
    expect(formatNumber(7.55, 2, 0)).toBe("7,55");
    expect(formatNumber(7.567, 2, 0)).toBe("7,57");
    await i18n.changeLanguage("en");
    expect(formatNumber(7.5, 2, 0)).toBe("7.5");
    await i18n.changeLanguage("sv");
    // Svensk bruger U+00A0 (et blødt mellemrum) som tusindtalsseparator, så
    // den *forventede* streng ryddes væk — ellers ville testen dømme en
    // normalisering, der ikke sker.
    expect(ryd(formatNumber(1234.5, 2, 0))).toBe("1 234,5");
  });
});

describe("formatCurrency med et bestemt antal decimaler", () => {
  it("låser antallet, rapportens momstabel viste", async () => {
    // `formatKrPrecise` i `ReportView` skrev præcis to decimaler og satte så
    // " kr" ved siden af. Nu kommer symbolet fra `Intl`, så det følger sprog,
    // og antallet låses på begge sider.
    await i18n.changeLanguage("da");
    expect(ryd(formatCurrency(1234.5, 2))).toBe("1.234,50 kr.");
    expect(ryd(formatCurrency(1234.567, 2))).toBe("1.234,57 kr.");
    await i18n.changeLanguage("de");
    expect(ryd(formatCurrency(1234.5, 2))).toBe("1.234,50 DKK");
    await i18n.changeLanguage("en");
    expect(ryd(formatCurrency(1234.5, 2))).toBe("DKK 1,234.50");
  });

  it("kan skrive et helt beløb uden decimaler", async () => {
    // Uden " kr" ved siden af — `formatKr` skrev `Math.round(x)` og en
    // hårdkodet "kr", så symbolets placering var dansk i alle sprog.
    await i18n.changeLanguage("da");
    expect(ryd(formatCurrency(1234.6, 0))).toBe("1.235 kr.");
    await i18n.changeLanguage("en");
    expect(ryd(formatCurrency(1234.6, 0))).toBe("DKK 1,235");
  });
});
