import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

/**
 * Beskeden om en gendannet database.
 *
 * Denne besked er den *eneste* grunden til, at recovery-vejen i `db/mod.rs` er
 * acceptabel. Uden den starter appen på en tom database, alt ser normalt ud,
 * og brugeren opdager en måned efter at hans registrerede tid er væk — uden nogen
 * mistanke om hvorfor. Derfor dømmer testen tre ting der en slævkommando ville
 * have sprunget over:
 *
 * 1. **Stien vises.** Beskedens hele pointe er filnavnet. Uden det kan brugeren
 *    ikke hente sin database til en specialist.
 * 2. **Beskeden siger at data IKKE er væk.** «Din database var beskadiget» uden
 *    «din tid er ikke slettet» får brugeren til at tro han har mistet alt, og
 *    han importerer så den *nyeste* backup oveni sin gamle database — og
 *    overskriver de registreringer der lå efter backup'en.
 * 3. **Alle fem sprog.** `fallbackLng: "da"` gør en manglende nøgle usynlig, så
 *    en tysk bruger ville se dansk tekst om at han mistede data.
 */

let recovery: unknown = null;
let kaldFejler: Error | null = null;
const kaldeKald: string[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    kaldeKald.push(cmd);
    if (kaldFejler) throw kaldFejler;
    if (cmd === "get_database_recovery") return recovery;
    return null;
  },
}));

import { DatabaseRecoveryBanner } from "../DatabaseRecoveryBanner";

const LANGS = { da, en, sv, nb, de } as const;
type Lang = keyof typeof LANGS;
const ALLE_LANG: Lang[] = ["da", "en", "sv", "nb", "de"];

function flatten(node: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof node !== "object" || node === null) return out;
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of flatten(value, full)) out.set(k, v);
    } else {
      out.set(full, String(value));
    }
  }
  return out;
}

const TABLES = Object.fromEntries(
  Object.entries(LANGS).map(([lang, json]) => [lang, flatten(json)]),
) as Record<Lang, Map<string, string>>;

/** En nøgle der mangler i et sprog har her en tom værdi, så testen stopper med det. */
function value(lang: Lang, key: string) {
  return TABLES[lang].get(key) ?? "";
}

const TITEL = "databaseRecovery.title";
const FORKLARING = "databaseRecovery.explanation";
const LUK = "databaseRecovery.dismiss";

/** Stien som Rust bygger den: et drev-sti på Windows og et unix-sti andre steder. */
const STI = navigator.platform.startsWith("Win")
  ? String.raw`C:\Users\Mads\AppData\Roaming\dk.timetrack.desktop\timetrack.beskadiget-20261001-171155`
  : "/Users/mads/Library/Application Support/dk.timetrack.desktop/timetrack.beskadiget-20261001-171155";

async function saaEnRecovery(lang: Lang, svar: unknown = { backup_sti: STI }) {
  recovery = svar;
  i18n.changeLanguage(lang);
  render(<DatabaseRecoveryBanner />);
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  kaldeKald.length = 0;
  recovery = null;
  kaldFejler = null;
  i18n.changeLanguage("da");
});

afterEach(() => {
  cleanup();
  i18n.changeLanguage("da");
});

describe("DatabaseRecoveryBanner", () => {
  it("viser intet når inten blev gendannet — den normale start", async () => {
    await saaEnRecovery("da", null);

    expect(kaldeKald).toContain("get_database_recovery");
    // Ingen besked må stå og optage plads oven over appen hver eneste morgen.
    expect(screen.queryByText(value("da", TITEL))).toBeNull();
    expect(document.body.textContent).toBe("");
  });

  it("viser intet når kommandoen fejler — Tauri kan være ikke klar endnu", async () => {
    // `get_database_recovery` svarer altid Ok, så en fejl betyder at IPC ikke
    // virker endnu. En fejl er IKKE en besked om tab, og en besked der løj om
    // tab ville få brugeren til at importere en backup ovenpå sin gode database.
    kaldFejler = new Error("ipc unavailable");
    i18n.changeLanguage("da");
    render(<DatabaseRecoveryBanner />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.body.textContent).toBe("");
  });

  // Point 3: alle fem sprog renderer den fulde besked.
  for (const lang of ALLE_LANG) {
    it(`viser hele beskeden på ${lang}`, async () => {
      await saaEnRecovery(lang);

      expect(screen.getByText(value(lang, TITEL))).toBeTruthy();
      expect(screen.getByText(value(lang, FORKLARING))).toBeTruthy();
    });
  }

  it("viser stien — uden den er beskeden ubrugelig", async () => {
    await saaEnRecovery("da");

    // Stien skal være i DOM'en præcis som Rust sendte den. `textContent` på
    // banneret dømmer den, så en formatering der kun findes i CSS (fx
    // `text-overflow`) ikke kan skjule den.
    const tekst = document.body.textContent ?? "";
    expect(tekst).toContain(STI);
    // Ikke kun et stykke af den: brugeren skal kunne kopiere hele stien.
    expect(tekst).toContain("timetrack.beskadiget-20261001-171155");
  });

  // Point 2: beskeden skal sige at data ikke er væk.
  it("siger at tiden ikke er slettet — ellers overskriver brugeren sin database", async () => {
    for (const lang of ALLE_LANG) {
      cleanup();
      await saaEnRecovery(lang);
      const tekst = value(lang, FORKLARING).toLowerCase();

      // Ét sprog må ikke love det, mens et andet tier. Vi søger på meningen,
      // ikke på et enkelt ord — «ikke slettet» på dansk er «inte borttagna» på
      // svensk, og en hårdkodet søgning på ét ord ville være grøn for fire sprog.
      const loverData =
        /(ikke slettet|inte borttagna|har inte|not been deleted|wurden nicht gelöscht)/i.test(
          tekst,
        );
      expect(
        loverData,
        lang +
          ": «" +
          tekst +
          "» siger ikke at brugerens tid er bevaret — uden den tror han alt " +
          "er væk og importerer en backup ovenpå sin database",
      ).toBe(true);

      // Og den skal pege hen på den handling der får data tilbage.
      expect(tekst).toMatch(/import/i);
    }
  });

  it("kan lukkes, men beskeden kommer igen ved næste start", async () => {
    await saaEnRecovery("da");

    const luk = screen.getByRole("button", {
      name: value("da", LUK),
    });
    fireEvent.click(luk);

    expect(screen.queryByText(value("da", TITEL))).toBeNull();

    // Beviset på at lukning kun gælder denne session: der gemmes ikke noget i
    // `localStorage`. Uden en gemt nøgle kommer beskeden igen, fordi en bruger
    // der lige har mistet sin database ellers aldrig ville se den igen.
    expect(Object.keys(localStorage)).toHaveLength(0);

    cleanup();
    await saaEnRecovery("da");
    expect(screen.getByText(value("da", TITEL))).toBeTruthy();
  });

  it("luk-knappen har et navn i hvert sprog — en skærmlæser skal høre den", async () => {
    for (const lang of ALLE_LANG) {
      cleanup();
      await saaEnRecovery(lang);

      // `TrialBanner` bruger samme mønster; en ikonknap uden navn er præcis
      // den fejl K56 lukkede 28 steder af.
      const knapper = screen.getAllByRole("button");
      expect(knapper).toHaveLength(1);
      const navn = knapper[0].getAttribute("aria-label") ?? "";
      expect(navn).toBe(value(lang, LUK));
      expect(navn.length).toBeGreaterThan(0);
    }
  });
});
