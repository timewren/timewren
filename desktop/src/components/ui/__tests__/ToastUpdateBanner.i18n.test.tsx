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
 * De to sidste `aria-label` der lå i markup'en som dansk: bannerets luk-knap og
 * notifikationens luk-knap. Begge er *kun* et navn — der står ingen tekst ved
 * siden af dem, så en skærmlæser hører ordet og ingenting else, og en svensk,
 * norsk eller tysk bruger får dansk.
 *
 * De er samme fejl i samme mønster, så de dømmes i én fil. Banneret havde desuden
 * tre danske sætninger tilbage oveni: «er tilgængelig», «Henter...» og
 * «Installer nu». De to sidste lå i en terning i JSX — hverken synlig tekst
 * eller en `set*`-sætter, så hverken `i18n.test.ts` eller `uiTextScanner` så dem.
 * Derfor dømmer denne test hele den synlige tekst, ikke bare navnene: en
 * hardkodet sætning i banneret ville være usynlig for portene og synlig her.
 */

let opdatering: unknown = null;
let fejl: Error | null = null;
const kaldeKald: string[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    kaldeKald.push(cmd);
    if (fejl) throw fejl;
    if (cmd === "check_for_update") return opdatering;
    return null;
  },
}));

import { useToastStore } from "@/stores/toastStore";
import { ToastContainer } from "../ToastContainer";
import { UpdateBanner } from "../UpdateBanner";

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

/**
 * `fallbackLng: "da"` gør en manglende nøgle usynlig: `t()` svarer med dansk, og
 * skærmen ser rigtig ud. Derfor læses json'en direkte — en nøgle der mangler i
 * et sprog har her en tom værdi, og testen stopper med det.
 */
function value(lang: Lang, key: string) {
  return TABLES[lang].get(key) ?? "";
}

/** Samme form som i18nexts interpolation, så testen ikke hænger ved `{{version}}`. */
function medVersion(tekst: string, version = "9.8.7") {
  return tekst.replace("{{version}}", version);
}

const NOTIFIKATION = "common.closeNotification";
const TILGAENGELIG = "updates.newVersionAvailable";
const INSTALLER_NU = "updates.installNow";
const HENTER = "updates.installing";
const LUK_BANNER = "updates.dismiss";

const VERSION = { version: "9.8.7", body: null, date: null };

function saaEnNotifikation() {
  // `addToast` ville starte en 3-sekunders-timer, der tømmer listen igen; her
  // sættes den direkte, så eneste vejen ud er knappen der dømmes.
  useToastStore.setState({
    toasts: [{ id: "t1", message: "Gemt", type: "success" }],
  });
  render(<ToastContainer />);
}

async function saaEtBanner(lang: Lang) {
  opdatering = VERSION;
  render(<UpdateBanner />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  return screen.getByText(medVersion(value(lang, TILGAENGELIG)));
}

beforeEach(() => {
  kaldeKald.length = 0;
  opdatering = null;
  fejl = null;
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await i18n.changeLanguage("da");
});

describe("notifikationens luk-knap følger appens sprog", () => {
  it("har et tilgængeligt navn i alle 5 sprog", async () => {
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      saaEnNotifikation();

      expect(value(lang, NOTIFIKATION), `${lang}:${NOTIFIKATION}`).not.toBe("");
      expect(
        screen.getByRole("button", { name: value(lang, NOTIFIKATION) }),
        lang,
      ).toBeTruthy();
    }
  });

  it("afsiger det danske navn i et ikke-dansk sprog", async () => {
    // Ellers ville testen ovenfor være grøn, fordi `fallbackLng: "da"` serverede
    // dansk i stedet for den manglende nøgle.
    for (const lang of ALLE_LANG) {
      if (lang === "da") continue;
      cleanup();
      await i18n.changeLanguage(lang);
      saaEnNotifikation();

      expect(
        screen.queryByRole("button", { name: value("da", NOTIFIKATION) }),
        `${lang}: dansk overlevde`,
      ).toBeNull();
    }
  });

  it("fjerner netop den notifikation, hvis knap trykkes", async () => {
    // Et navn der sidder på en knap uden handling er værre end intet navn:
    // brugeren hører «Luk notifikation», trykker, og beskeden bliver stående.
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      saaEnNotifikation();

      fireEvent.click(
        screen.getByRole("button", { name: value(lang, NOTIFIKATION) }),
      );
      expect(useToastStore.getState().toasts, lang).toHaveLength(0);
    }
  });
});

describe("opdateringsbanneret følger appens sprog", () => {
  it("skriver hele sætningen i appens sprog, med den version Rust sender", async () => {
    // Sætningen var to danske brudstykker omkring `{update.version}`. Dømmes
    // hele teksten, fordi kun `version` kommer fra Rust — en hardkodet sætning
    // omkring den ville være usynlig for `uiTextScanner` (terningen er hverken
    // JsxText eller attribut) og ville blive dansk for alle sprog.
    vi.useFakeTimers();
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      const tekst = await saaEtBanner(lang);

      expect(value(lang, TILGAENGELIG), `${lang}:${TILGAENGELIG}`).not.toBe("");
      expect(tekst.textContent, lang).toBe(
        medVersion(value(lang, TILGAENGELIG)),
      );
      // Bevis for at det er Rusts version og ikke en frossen værdi fra koden.
      expect(tekst.textContent, lang).toContain(VERSION.version);
    }
  });

  it("afsiger den danske sætning i et ikke-dansk sprog", async () => {
    vi.useFakeTimers();
    for (const lang of ALLE_LANG) {
      if (lang === "da") continue;
      cleanup();
      await i18n.changeLanguage(lang);
      await saaEtBanner(lang);

      expect(
        screen.queryByText(medVersion(value("da", TILGAENGELIG))),
        `${lang}: dansk overlevde`,
      ).toBeNull();
    }
  });

  it("har en installér-knap på appens sprog", async () => {
    vi.useFakeTimers();
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      await saaEtBanner(lang);

      expect(value(lang, INSTALLER_NU), `${lang}:${INSTALLER_NU}`).not.toBe("");
      expect(
        screen.getByRole("button", { name: value(lang, INSTALLER_NU) }),
        lang,
      ).toBeTruthy();
    }
  });

  it("skriver «henter»-tilstanden på appens sprog under installation", async () => {
    // Den her lå i en terning, så den var dansk for alle sprog i praksis: den
    // sås kun mens installationen kørte, altså præcis når brugeren venter.
    vi.useFakeTimers();
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      await saaEtBanner(lang);

      fireEvent.click(
        screen.getByRole("button", { name: value(lang, INSTALLER_NU) }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(value(lang, HENTER), `${lang}:${HENTER}`).not.toBe("");
      expect(
        screen.getByRole("button", { name: value(lang, HENTER) }),
        lang,
      ).toBeTruthy();
      expect(kaldeKald, lang).toContain("install_update");
    }
  });

  it("har en luk-knap med appens sprog, der lukker banneret", async () => {
    vi.useFakeTimers();
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      await saaEtBanner(lang);

      expect(value(lang, LUK_BANNER), `${lang}:${LUK_BANNER}`).not.toBe("");
      const knap = screen.getByRole("button", {
        name: value(lang, LUK_BANNER),
      });
      fireEvent.click(knap);

      expect(
        screen.queryByText(medVersion(value(lang, TILGAENGELIG))),
        lang,
      ).toBeNull();
    }
  });

  it("afsiger det danske navn på luk-knappen i et ikke-dansk sprog", async () => {
    vi.useFakeTimers();
    for (const lang of ALLE_LANG) {
      if (lang === "da") continue;
      cleanup();
      await i18n.changeLanguage(lang);
      await saaEtBanner(lang);

      expect(
        screen.queryByRole("button", { name: value("da", LUK_BANNER) }),
        `${lang}: dansk overlevde`,
      ).toBeNull();
    }
  });

  it("viser intet når der ikke er nogen opdatering, og siger intet om hvorfor", async () => {
    // Svagt og tilfældigt: `check_for_update` kan svare `null` *eller* kaste
    // (uden internet). Begge dele skal ende i det samme: ingen banner.
    for (const svar of [null, "kast"]) {
      cleanup();
      vi.useFakeTimers();
      opdatering = svar === "kast" ? null : svar;
      fejl = svar === "kast" ? new Error("netværk") : null;
      render(<UpdateBanner />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(kaldeKald, String(svar)).toContain("check_for_update");
      expect(screen.queryAllByRole("button"), String(svar)).toHaveLength(0);
      expect(document.body.textContent, String(svar)).not.toContain(
        "tilgængelig",
      );
    }
  });
});
