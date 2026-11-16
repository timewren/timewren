import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";
import { useSyncStore } from "@/stores/syncStore";

/**
 * `loadStatus` kører i en effekt og skriver de felger, serveren ejer, ind i
 * store'en — så det er `status` her, og ikke `setState`, der bestemmer hvad
 * komponenten viser. Uden den kobling ville testen sætte state og se den blive
 * overskrevet af et tomt mock-svar, og de loggede-visning-tests ville være
 * grønne uden at have set den.
 */
let status: Record<string, unknown> = {};

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => status }));

import { SyncSettings } from "../SyncSettings";

const LANGS = { da, en, sv, nb, de } as const;
type Lang = keyof typeof LANGS;
const ALLE_LANG: Lang[] = ["da", "en", "sv", "nb", "de"];
const OTHER_LANGS = ["en", "sv", "nb", "de"] as Lang[];

/** Nøglen → flad streng, så bøjningsformer (`_one`/`_other`) kan læses samlet. */
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
 * Den sætning brugeren skal se. Med `count` læses bøjningsformen og
 * `{{count}}` sættes ind, så `sync.pendingCount` kan dømmes i både "1 ventende
 * ændring" og "3 ventende ændringer" — kun den ene form ville være et svagt
 * bevis, og en uinterpreteret `{{count}}` ville slet ikke være en sætning.
 *
 * Oplæseren efter `_one`/`_other` og falder tilbage til nøglen uden bøjning,
 * som i18next gør: `sync.minutesAgo` har kun én form, fordi "5 min siden" og
 * "1 min siden" er ens på alle fem sprog.
 */
function value(lang: Lang, key: string, count?: number): string {
  if (count === undefined) return TABLES[lang].get(key) ?? "";
  const suffix = count === 1 ? "_one" : "_other";
  const rå = TABLES[lang].has(`${key}${suffix}`)
    ? TABLES[lang].get(`${key}${suffix}`)
    : TABLES[lang].get(key);
  return (rå ?? "").replaceAll("{{count}}", String(count));
}

/** Nøgler i den udloggede visning. */
const UDEN_LOGIN = [
  "sync.title",
  "sync.connectSubtitle",
  "sync.connect",
  "sync.loginWithEmail",
  "sync.noAccount",
  "sync.signupFree",
] as const;

/**
 * Nøgler i den loggede visning. `sync.lastSync` og `sync.never` er *ikke* her:
 * de står sammen i én `<span>`, som to tekstnoder, og dømmes via `syncLinje()`.
 * `common.cancel` er heller ikke her: knappen findes kun når
 * bekræftelsespanelet er åbent, og den dømmes i knap-testen. Kun den ene
 * bøjning af `sync.pendingCount` tages med, fordi `loggetInd()` sætter ét
 * bestemt antal — resten dømmes i bøjningstesten.
 */
const MED_LOGIN: readonly (readonly [string, number | undefined])[] = [
  ["license.solo", undefined],
  ["sync.connected", undefined],
  ["sync.pendingCount", 1],
  ["sync.syncNow", undefined],
  ["sync.autoEveryFiveMinutes", undefined],
  ["sync.logout", undefined],
  ["sync.logoutDescription", undefined],
];

/**
 * Fuld tekst på linjen "Sidst synkroniseret: …". React deler den i to
 * tekstnoder — etiketten og resultatet — så `getByText` på hver især ville
 * aldrig finde dem. Uden denne hentning ville testen springe linjen over.
 */
function syncLinje(): string | undefined {
  const markering = `${value(i18n.language as Lang, "sync.lastSync")}: `;
  return [...document.querySelectorAll("span")]
    .map((s) => s.textContent ?? "")
    .find((tekst) => tekst.startsWith(markering));
}

function loggetInd(
  tier: string | null = "solo",
  lastSync: string | null = null,
  pendingChanges = 1,
) {
  status = {
    is_logged_in: true,
    user_email: "mads@eksempel.dk",
    user_name: "Mads Holm",
    tier,
    last_sync: lastSync,
    pending_changes: pendingChanges,
  };
}

function loggetUd() {
  status = {
    is_logged_in: false,
    user_email: null,
    user_name: null,
    tier: null,
    last_sync: null,
    pending_changes: 0,
  };
}

afterEach(async () => {
  cleanup();
  status = {};
  useSyncStore.setState({
    isLoggedIn: false,
    userEmail: null,
    userName: null,
    tier: null,
    lastSync: null,
    pendingChanges: 0,
    isSyncing: false,
    isLoggingIn: false,
    isConnecting: false,
    error: null,
  });
  await i18n.changeLanguage("da");
});

/**
 * Synkroniseringen lå med 24 danske strenge på egne linjer i 30/9. Det er den
 * side en betalt bruger logger ind på, og dens felter — adgangskode, "Log ud",
 * bekræftelsen — er dem, han læser, når han vil have sine data med i en ny
 * maskine. Porten i `i18n.test.ts` dømmer nøgler og rå JSX hver for sig, men
 * ingen af dem ser, om den *valgte* nøgle overhovedet havner i DOM'en. Her
 * skifter testen sprog og dømmer de værdier, der afviger fra dansk.
 */
describe("Synkronisering følger appens sprog", () => {
  it("viser dansk på dansk, både uden og med login", async () => {
    loggetUd();
    render(<SyncSettings />);
    for (const key of UDEN_LOGIN) {
      expect(screen.getAllByText(value("da", key)).length).toBeGreaterThan(0);
    }

    cleanup();
    loggetInd();
    render(<SyncSettings />);
    for (const [key, count] of MED_LOGIN) {
      // `findAllByText` venter på `loadStatus`, der skriver i store'en i en
      // effekt — ellers ville de loggede nøgler være dømt, før de findes.
      expect(
        (await screen.findAllByText(value("da", key, count))).length,
      ).toBeGreaterThan(0);
    }
  });

  for (const lang of OTHER_LANGS) {
    it(`viser ${lang} på ${lang} i den udloggede visning`, async () => {
      await i18n.changeLanguage(lang);
      loggetUd();
      render(<SyncSettings />);

      const afvigende = UDEN_LOGIN.filter(
        (key) => value(lang, key) !== value("da", key),
      );
      // Uden dette ville testen være grøn, hvis visningen bare var blevet tom.
      // Norsk og svensk deler enkelte ord med dansk, så tallet varierer — 4 er
      // det laveste, alle fire faktisk har.
      expect(afvigende.length).toBeGreaterThanOrEqual(4);

      const mangler = afvigende.filter(
        (key) => screen.queryAllByText(value(lang, key)).length === 0,
      );
      expect(mangler).toEqual([]);

      // Og ingen dansk fra markup'en må overleve i et ikke-dansk sprog.
      const danske = afvigende.filter(
        (key) => screen.queryAllByText(value("da", key)).length > 0,
      );
      expect(danske).toEqual([]);
    });

    it(`viser ${lang} på ${lang} i den loggede visning`, async () => {
      await i18n.changeLanguage(lang);
      loggetInd();
      render(<SyncSettings />);

      const afvigende = MED_LOGIN.filter(
        ([key, count]) => value(lang, key, count) !== value("da", key, count),
      );
      expect(afvigende.length).toBeGreaterThanOrEqual(6);

      // `findAllByText` venter på `loadStatus`, der skriver i store'en i en
      // effekt. Uden ventetiden ville de loggede nøgler være dømt, før de
      // findes — altså springt over i stedet for at fange at de står på dansk.
      const mangler: string[] = [];
      for (const [key, count] of afvigende) {
        if (
          (await screen.findAllByText(value(lang, key, count))).length === 0
        ) {
          mangler.push(key);
        }
      }
      expect(mangler).toEqual([]);

      const danske = afvigende.filter(
        ([key, count]) =>
          screen.queryAllByText(value("da", key, count)).length > 0,
      );
      expect(danske).toEqual([]);
    });
  }

  it("sætter etiketten og klokkeslættet sammen i alle 5 sprog", async () => {
    // `Sidst synkroniseret:` lå på egne linjer i JSX, og var den eneste streng i
    // komponenten, der ikke var en nøgle — scanneren dømte den, men der var
    // ingen nøgle at glide fra. Linjen dømmes derfor på sin fulde tekst.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      cleanup();
      loggetInd("solo", null);
      render(<SyncSettings />);
      await screen.findByText(value(lang, "sync.connected"));
      expect(syncLinje()).toBe(
        `${value(lang, "sync.lastSync")}: ${value(lang, "sync.never")}`,
      );
    }
  });

  it("bøjer ventende ændringer i alle 5 sprog", async () => {
    // `{pendingChanges === 1 ? "ændring" : "ændringer"}` lå i markup'en. Den
    // ene og den anden form skal begge findes, ellers får en bruger
    // "1 ventende ændringer" i dansk og "1 ventende endringer" på norsk.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      for (const antal of [1, 2, 7]) {
        cleanup();
        loggetInd("solo", null, antal);
        render(<SyncSettings />);
        expect(
          await screen.findByText(value(lang, "sync.pendingCount", antal)),
        ).toBeTruthy();
      }
    }
  });

  it("bøjer tid siden sidste synk i alle 5 sprog", async () => {
    // `formatSyncTime` lå med "Aldrig", "Lige nu", "N min siden" og
    // "N timer siden" i kode. Alle fire grene dømmes her, i alle fem sprog.
    const forAntalMinutter = (minutter: number) =>
      new Date(Date.now() - minutter * 60_000).toISOString();

    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);

      for (const [minutter, noegle, antal] of [
        [null, "sync.never", undefined],
        [0, "sync.justNow", undefined],
        [5, "sync.minutesAgo", 5],
        [60, "sync.hoursAgo", 1],
        [300, "sync.hoursAgo", 5],
      ] as const) {
        cleanup();
        loggetInd(
          "solo",
          minutter === null ? null : forAntalMinutter(minutter),
        );
        render(<SyncSettings />);
        await screen.findByText(value(lang, "sync.connected"));
        expect(syncLinje()).toBe(
          `${value(lang, "sync.lastSync")}: ${value(lang, noegle, antal)}`,
        );
      }
    }
  });

  it("formaterer en gammel synk i det aktive sprog", async () => {
    // Over 24 timer falder `formatSyncTime` tilbage til `toLocaleDateString`,
    // som før var hårdkodet til `da-DK` — så en tysk bruger fik dansk
    // datoformat oven på tysk tekst. Datoen er fast, så kun
    // datoformatets *rækkefølge* kan afsløre sproget.
    const gammel = new Date(2026, 0, 5, 14, 30);
    for (const lang of ["da", "en", "de"] as Lang[]) {
      await i18n.changeLanguage(lang);
      cleanup();
      loggetInd("solo", gammel.toISOString());
      render(<SyncSettings />);
      const forventet = gammel.toLocaleDateString(lang, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      expect(
        await screen.findAllByText(new RegExp(escapeRegExp(forventet))),
      ).toHaveLength(1);
    }
  });

  it("viser et ukendt tier råt i stedet for at gæte", async () => {
    // `TIER_LABELS[tier] ?? tier` viste det rå navn, hvis serveren sendte en
    // plan koden ikke kender. Det er ærte forude: en ny plan må ikke vise sig
    // som "Gratis", fordi den deler nøgle med den gratis.
    loggetInd("enterprise");
    render(<SyncSettings />);
    expect(await screen.findByText("enterprise")).toBeTruthy();
    expect(screen.queryByText(value("da", "license.free"))).toBeNull();
  });

  it("siger 'Ukendt' når serveren ikke sender et tier", async () => {
    loggetInd(null);
    render(<SyncSettings />);
    expect(
      (await screen.findAllByText(value("da", "sync.tierUnknown"))).length,
    ).toBeGreaterThan(0);
  });

  it("oversætter de knapper, der kun findes under betingelser", async () => {
    // Forbindelsesfeltet, email-formularen og synkknappens to grene er aldrig
    // i DOM'en samtidig, så de dømmes hver for sig — ellers ville de tre
    // betingelser være udokumenterede.
    await i18n.changeLanguage("de");
    loggetUd();

    useSyncStore.setState({ isConnecting: true });
    render(<SyncSettings />);
    for (const key of [
      "sync.waitingForApproval",
      "sync.browserOpened",
      "common.cancel",
    ]) {
      expect(screen.getAllByText(value("de", key)).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText(value("da", "sync.connect"))).toBeNull();

    cleanup();
    useSyncStore.setState({ isConnecting: false, isLoggingIn: true });
    render(<SyncSettings />);
    fireEvent.click(screen.getByText(value("de", "sync.loginWithEmail")));
    expect(
      screen.getAllByText(value("de", "sync.loggingIn")).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(value("da", "sync.login"))).toBeNull();

    cleanup();
    useSyncStore.setState({ isLoggingIn: false });
    loggetInd("team");
    useSyncStore.setState({ isSyncing: true });
    render(<SyncSettings />);
    expect(
      (await screen.findAllByText(value("de", "sync.syncing"))).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(value("da", "sync.syncNow"))).toBeNull();

    cleanup();
    loggetInd("team");
    // `isSyncing` står stadig true fra blokken oven — uden nulstilling ville
    // synkknappen vise synk-grenen, og testen ville dømme logout-sektionen
    // ved siden af en knap i en tilstand, brugeren aldrig ser samtidig.
    useSyncStore.setState({ isSyncing: false });
    render(<SyncSettings />);
    expect(
      screen.getAllByText(value("de", "sync.syncNow")).length,
    ).toBeGreaterThan(0);
    // `sync.logout` står både som overskrift og på knappen; det er knappen,
    // der åbner bekræftelsen, så den *sidste* forekomst trykkes.
    const forekomster = await screen.findAllByText(value("de", "sync.logout"));
    fireEvent.click(forekomster[forekomster.length - 1] as HTMLElement);
    expect(
      screen.getAllByText(value("de", "sync.logoutConfirm")).length,
    ).toBeGreaterThan(0);
  });

  it("sætter en fejl fra login i brugerens sprog", async () => {
    // `catch (err) { setLoginError(typeof err === "string" ? err : …) }` lagde
    // den danske "Login fejlede" i koden. Rust kan give en streng, så kun den
    // anden gren er oversat — men den er den, der er synlig for brugeren her.
    const { login } = useSyncStore.getState();
    useSyncStore.setState({
      login: async () => {
        throw new Error("boom");
      },
    });
    await i18n.changeLanguage("de");
    loggetUd();

    render(<SyncSettings />);
    fireEvent.click(screen.getByText(value("de", "sync.loginWithEmail")));
    fireEvent.change(screen.getByPlaceholderText(value("de", "common.email")), {
      target: { value: "mads@eksempel.dk" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(value("de", "sync.password")),
      {
        target: { value: "hemmelighed" },
      },
    );
    fireEvent.click(screen.getByText(value("de", "sync.login")));

    expect(
      await screen.findByText(value("de", "sync.loginFailed")),
    ).toBeTruthy();
    useSyncStore.setState({ login });
  });
});

/** `RegExp` må ikke tolke punktum i "5. jan." som jokertegn. */
function escapeRegExp(tekst: string): string {
  return tekst.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
