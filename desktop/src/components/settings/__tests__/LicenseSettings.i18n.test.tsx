import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

/**
 * Hvert `invoke`-kald fanges her, så testen kan få backend'en til at svare med
 * den licens, den skal se. `LicenseSettings` kalder `tauriInvoke`, som går
 * lige til `invoke` — så mocken dømmer den rigtige vej.
 */
let svar: Record<string, unknown> = {};
let fejl: Record<string, unknown> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd in fejl) throw fejl[cmd];
    return svar[cmd];
  },
}));

import { LicenseSettings } from "../LicenseSettings";

const LANGS = { da, en, sv, nb, de } as const;
type Lang = keyof typeof LANGS;
const ALLE_LANG: Lang[] = ["da", "en", "sv", "nb", "de"];
const ANDRE_LANG = ["en", "sv", "nb", "de"] as Lang[];

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

/**
 * Nøglen → den sætning brugeren skal se.
 *
 * Den læser json-tabellen og *ikke* `i18n.t`. Det er pointen: en nøgle der
 * mangler i `de.json` ville givet `i18n.t` sit eget navn tilbage — præcis som
 * komponentens eget `t` gør — så testen ville være grøn, fordi den dømmer fejlen
 * med det samme værktøj. En manglende nøgle skal her kaste i stedet.
 */
function value(lang: Lang, key: string, params?: Record<string, string>) {
  const rå = TABLES[lang].get(key);
  if (rå === undefined) throw new Error(`${lang} mangler nøglen ${key}`);
  let sætning = rå;
  for (const [navn, tal] of Object.entries(params ?? {})) {
    sætning = sætning.replaceAll(`{{${navn}}}`, tal);
  }
  return sætning;
}

/**
 * Den pluralform i18next vælger for et tal, læst fra tabellen. Dansk og tysk
 * skelner mellem 1 og resten, så en tab kun med `_other` ville give "1 enheder
 * tilladt" — og `i18n.test.ts` dømmer kun pluralformer for `timeline.bulk*`.
 */
function plural(lang: Lang, key: string, count: number): string {
  const form = count === 1 ? "_one" : "_other";
  const rå = TABLES[lang].get(`${key}${form}`);
  if (rå === undefined) {
    throw new Error(`${lang} mangler pluralformen ${key}${form}`);
  }
  return rå.replaceAll("{{count}}", String(count));
}

/**
 * Testbibliotekets forvalg normaliserer tekst. Her skal det ikke: `Button`
 * sætter ikonet og etiketten i samme knap, så `queryAllByText` skal kunne se
 * hele knappens tekst.
 */
const UØRET = { normalizer: (tekst: string) => tekst.trim() } as const;

/** Nøgler i den synlige del, når brugeren *ikke* har en licens. */
const UDEN_LICENS = [
  "license.noLicense",
  "license.buyPitch",
  "license.activate",
  "license.buyLicense",
  "license.seePricing",
  "common.open",
] as const;

/**
 * Nøgler i den synlige del, når licensen er aktiv. `license.offlineDays` er
 * ikke med: den sætter et tal ind, så den dømmes for sig selv.
 */
const MED_LICENS = [
  "license.key",
  "license.active",
  "license.devices",
  "license.expires",
  "license.verifyOnline",
  "license.deactivate",
  "license.deactivateHint",
  "license.deactivateBtn",
  "license.upgradePlan",
] as const;

const BEVIS = {
  license_key: "TT-ABCD-EFGH-IJKL-MNOP",
  tier: "lifetime",
  valid_until: "2027-01-01",
  devices_allowed: 3,
  issued_at: "2026-01-01",
  verified_at: "2026-09-30",
};

/**
 * Standard-svaret: en licens der er gyldig, men endnu ikke verificeret igen.
 * `needs_verification: true` er ikke tilfældigt — den er den eneste måde
 * opfordringen til at gå online bliver vist på, så porten dømmer den.
 */
const STATUS = {
  is_valid: true,
  tier: "lifetime",
  days_until_expiry: 45,
  offline_days: 0,
  needs_verification: true,
};

function findAlle(tekst: string) {
  return screen.queryAllByText(tekst, UØRET);
}

/** Find alle forekomster af hver nøgle, og returnér dem der ikke blev fundet. */
function manglende(lang: Lang, nøgler: readonly string[]): string[] {
  return nøgler.filter((key) => findAlle(value(lang, key)).length === 0);
}

/** Samme, men for de nøgler der sætter et tal ind. */
function manglendeTal(
  lang: Lang,
  nøgler: readonly [string, number][],
): string[] {
  return nøgler
    .filter(([key, count]) => findAlle(plural(lang, key, count)).length === 0)
    .map(([key, count]) => `${key}(${count})`);
}

/**
 * Sætter licensen op, så den synlige del er den med nøgle, niveau og datoer.
 * `ændringer` lægges på både bevis og status, fordi de hver især kun læser
 * deres egne felter — `devices_allowed` kommer fra beviset og
 * `days_until_expiry` fra status.
 */
function medLicens(ændringer: Record<string, unknown> = {}) {
  svar = {
    get_license_info: { ...BEVIS, ...ændringer },
    verify_license: { ...STATUS, ...ændringer },
  };
}

async function renderMedLicens(ændringer: Record<string, unknown> = {}) {
  medLicens(ændringer);
  render(<LicenseSettings />);
  // Komponenten henter licensen i en effekt, så den skal vente på svaret — og
  // vente på det i det sprog testen har valgt.
  return screen.findByText(value(i18n.language as Lang, "license.key"));
}

beforeEach(() => {
  svar = { get_license_info: null, verify_license: STATUS };
  fejl = {};
});

afterEach(async () => {
  cleanup();
  svar = {};
  fejl = {};
  await i18n.changeLanguage("da");
});

/**
 * Licensen holdt 15 danske strenge på egne linjer i 30/9 — nøglens navn,
 * "Aktiv", "Offline 3d", "Enheder", "3 enheder tilladt", "Udløber", "45 dage",
 * opfordringen til at gå online, deaktiveringsafsnittets tre sætninger, købssiden
 * og "Åbn". Det er den side brugeren står på, når han vil betale for sin app.
 *
 * `i18n.test.ts` dømmer nøgler og rå JSX hver for sig, men ingen af dem ser, om
 * den *valgte* nøgle overhovedet havner i DOM'en — eller om den er dansk. Her
 * skifter testen sprog og dømmer de værdier, der afviger fra dansk.
 */
describe("Licensen følger appens sprog", () => {
  it("viser dansk på dansk", async () => {
    render(<LicenseSettings />);
    expect(
      await screen.findByText(value("da", "license.noLicense")),
    ).toBeTruthy();
    expect(manglende("da", UDEN_LICENS)).toEqual([]);
    // Pladsholderen er nøgleformatet fra licensserveren, ikke en sætning.
    expect(screen.getByPlaceholderText("TT-XXXX-XXXX-XXXX-XXXX")).toBeTruthy();
  });

  it("viser dansk på dansk med en aktiv licens", async () => {
    // `offline_days: 4` fordi badge'en kun vises offline — ellers ville de
    // nøgler i den række aldrig blive dømt.
    await renderMedLicens({ offline_days: 4 });
    expect(manglende("da", MED_LICENS)).toEqual([]);
    expect(findAlle(value("da", "license.lifetime"))).toHaveLength(1);
    expect(findAlle(plural("da", "license.devicesAllowed", 3))).toHaveLength(1);
    expect(findAlle(plural("da", "license.daysLeft", 45))).toHaveLength(1);
    expect(
      findAlle(value("da", "license.offlineDays", { days: "4" })),
    ).toHaveLength(1);
  });

  for (const lang of ANDRE_LANG) {
    it(`viser ${lang} på ${lang} uden licens`, async () => {
      await i18n.changeLanguage(lang);
      render(<LicenseSettings />);
      expect(
        await screen.findByText(value(lang, "license.noLicense")),
      ).toBeTruthy();

      const afvigende = UDEN_LICENS.filter(
        (key) => value(lang, key) !== value("da", key),
      );
      // Uden dette ville testen være grøn, hvis visningen bare var blevet tom.
      // `license.activate` og `common.open` deler et par ord med dansk andre
      // steder, så tallet varierer — 3 er det laveste, alle fire faktisk har.
      expect(afvigende.length).toBeGreaterThanOrEqual(3);
      expect(manglende(lang, afvigende)).toEqual([]);

      // Og ingen dansk fra markup'en må overleve i et ikke-dansk sprog.
      const danske = afvigende.filter(
        (key) => findAlle(value("da", key)).length > 0,
      );
      expect(danske).toEqual([]);
    });

    it(`viser ${lang} på ${lang} med en aktiv licens`, async () => {
      await i18n.changeLanguage(lang);
      await renderMedLicens({ offline_days: 4 });

      // `license.active` hedder "Aktiv" på fire af fem sprog, så det er ikke
      // alle nøgler der kan afvige. Resten skal: de er hele denne sides indhold.
      const afvigende = MED_LICENS.filter(
        (key) => value(lang, key) !== value("da", key),
      );
      expect(afvigende.length).toBeGreaterThanOrEqual(6);
      expect(manglende(lang, afvigende)).toEqual([]);

      const danske = afvigende.filter(
        (key) => findAlle(value("da", key)).length > 0,
      );
      expect(danske).toEqual([]);

      // Badge'en sætter sit eget tal ind, så den dømmes med sit eget sprog.
      expect(
        findAlle(value(lang, "license.offlineDays", { days: "4" })),
      ).toHaveLength(1);
    });
  }

  it("sætter licensniveauet i brugerens sprog i alle 5 sprog", async () => {
    // `TIER_LABELS` var et modul-kort med værdierne "Livstid", "Solo" og
    // "Team" — dansk i alle sprog, og uden for både nøglelisten og
    // JSX-scannerens synsfelt. Nu er kortet nøglenavne, så et tysk "Lebenslang"
    // er det samme bevis på at kortet er læst som nøgler.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      cleanup();
      await renderMedLicens();
      const etiket = value(lang, "license.lifetime");
      expect(etiket).not.toBe("license.lifetime");
      expect(findAlle(etiket)).toHaveLength(1);
    }
  });

  it("viser et ukendt niveau som det, Rust sendte", async () => {
    // `TIER_LABELS[proof.tier] ?? proof.tier ?? "Ukendt"` lagde "Ukendt" over
    // et niveau koden ikke kender, så en ny plan ville læse som dansk. Nu
    // bruges den danske sætning kun når der ikke er et niveau overhovedet.
    await i18n.changeLanguage("de");
    cleanup();
    await renderMedLicens();
    svar = {
      get_license_info: { ...BEVIS, tier: "studio" },
      verify_license: { ...STATUS, tier: "studio" },
    };
    render(<LicenseSettings />);
    expect(await screen.findByText("studio")).toBeTruthy();
  });

  it("bøjer antal enheder og dage i alle 5 sprog", async () => {
    // `_one` og `_other` er to forskellige sætninger: "1 enhed tilladt" mod "3
    // enheder tilladt", og det samme for dagene. Kun tabellen med ét antal ville
    // fange det, så testen renderer begge tal.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      for (const count of [1, 3]) {
        cleanup();
        await renderMedLicens({
          devices_allowed: count,
          days_until_expiry: count,
        });
        expect(
          manglendeTal(lang, [
            ["license.devicesAllowed", count],
            ["license.daysLeft", count],
          ]),
        ).toEqual([]);

        // Det forkerte antal må ikke stå nogen andre steder i DOM'en.
        const forker = count === 1 ? 3 : 1;
        expect(
          findAlle(plural(lang, "license.devicesAllowed", forker)),
        ).toEqual([]);
        expect(findAlle(plural(lang, "license.daysLeft", forker))).toEqual([]);
      }
    }
  });

  it("sætter dage offline i brugerens sprog", async () => {
    // `Offline {offline_days}d` lå i markup'en med tallet hårdkodet indeni.
    // Badge'en siger hvor længe licensen har været brugt uden internet, så
    // brugeren kan se om han skal sørge for at forbinde.
    await i18n.changeLanguage("de");
    cleanup();
    await renderMedLicens({ offline_days: 4 });
    expect(
      findAlle(value("de", "license.offlineDays", { days: "4" })),
    ).toHaveLength(1);
    expect(findAlle("Offline 4 d")).toEqual([]);
  });

  it("siger i brugerens sprog at aktiveringen mislykkedes", async () => {
    // `typeof err === "string" ? err : "Aktivering fejlede. Prøv igen."` — den
    // danske sætning lå i en `useState`-sætter, som hverken nøglelisten eller
    // scanneren ser. En tysk bruger fik den i rå dansk.
    await i18n.changeLanguage("de");
    render(<LicenseSettings />);
    expect(
      await screen.findByText(value("de", "license.noLicense")),
    ).toBeTruthy();

    fejl = { activate_license: new Error("boom") };
    fireEvent.change(screen.getByPlaceholderText("TT-XXXX-XXXX-XXXX-XXXX"), {
      target: { value: "TT-ABCD-EFGH-IJKL-MNOP" },
    });
    fireEvent.click(screen.getByText(value("de", "license.activate")));

    const besked = await screen.findByText(
      value("de", "license.activateFailed"),
    );
    expect(besked.textContent).toBe(value("de", "license.activateFailed"));
    expect(screen.queryByText("Aktivering fejlede. Prøv igen.")).toBeNull();
  });

  it("siger i brugerens sprog at deaktiveringen mislykkedes", async () => {
    // `catch { // Best effort }` slug fejlen helt: dialogen blev stående med
    // knappen deaktiveret og ingen forklaring, så brugeren troede at have
    // frigivet enheden. Det er den farligste af de to — den taber licensen.
    await i18n.changeLanguage("de");
    await renderMedLicens();
    fejl = { deactivate_license: new Error("filen er skrivebeskyttet") };

    fireEvent.click(screen.getByText(value("de", "license.deactivateBtn")));
    fireEvent.click(
      await screen.findByText(value("de", "license.deactivateConfirmBtn")),
    );

    const fejltekst = await screen.findByText(
      value("de", "license.deactivateFailed"),
    );
    expect(fejltekst.className).toContain("text-red-400");
    expect(screen.queryByText("Kunne ikke deaktivere. Prøv igen.")).toBeNull();

    // Dialogen skal stadig være åben, så brugeren kan prøve igen — og knappen
    // skal ikke være låst, fordi `deactivating` blev glemt.
    expect(
      screen.getByText(value("de", "license.deactivateConfirmBtn")),
    ).toBeTruthy();
  });

  it("viser Rusts egen besked når den er en streng", async () => {
    // Rust svarer `Result<_, String>`, så dens fejl er en streng og skal vises
    // ordret — den er oversat i den anden ende. `unknownTier`-logikken må ikke
    // ændre på det: kun den danske fallback er oversat.
    svar = { get_license_info: BEVIS, verify_license: STATUS };
    fejl = { deactivate_license: "Licensfilen kunne ikke slettes" };
    render(<LicenseSettings />);
    await screen.findByText(value("da", "license.key"));

    fireEvent.click(screen.getByText(value("da", "license.deactivateBtn")));
    fireEvent.click(
      await screen.findByText(value("da", "license.deactivateConfirmBtn")),
    );
    expect(
      await screen.findByText("Licensfilen kunne ikke slettes"),
    ).toBeTruthy();
  });
});
