import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

/**
 * Found 1/10: the Settings page and the calendar entry had Danish in the markup
 * that no gate could see, so a Swedish, Norwegian, German or English user read
 * «Udeluk private browservinduer», «Test kontekst-registrering» and
 * «Ingen projekt» on a screen that is otherwise fully translated.
 *
 * None of it was flagged. `uiTextScanner`'s `JsxText` rule only reads between
 * tags, so a string in a `{a ?? "…"}` was invisible, and it only knew the two
 * string forms without `${…}`, so «`${newCount} nye begivenheder importeret`»
 * was invisible too. Both blind spots are now closed in the scanner; this gate
 * exists because a scanner finding names a *string*, while what matters is what
 * the user reads on the screen in each language.
 *
 * It judges rendered DOM, not the locale files: a key can be translated in all
 * five languages and still not be used, and then the Danish stays.
 */

let synkResultat = 0;
let synkFejl = false;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "sync_calendar") {
      if (synkFejl) throw new Error("kalenderen svarede ikke");
      return synkResultat;
    }
    if (cmd === "get_setting") return null;
    if (cmd === "get_active_context") return { path: null, label: null };
    void args;
    return null;
  },
}));

import { CalendarEntry } from "@/components/calendar/CalendarEntry";
import { CalendarIntegration } from "../CalendarIntegration";
import { ContextDiagnostics } from "../ContextDiagnostics";
import { PrivacySettings } from "../PrivacySettings";

const LANGS = { da, en, sv, nb, de } as const;
type Lang = keyof typeof LANGS;
const ALLE_LANG: Lang[] = ["da", "en", "sv", "nb", "de"];

/** The sentence the user must see for `key` in `lang`. */
function sætning(lang: Lang, key: string): string {
  const tabel = LANGS[lang] as Record<string, unknown>;
  let node: unknown = tabel;
  for (const del of key.split(".")) {
    node = (node as Record<string, unknown>)[del];
    if (node === undefined) return "";
  }
  return typeof node === "string" ? node : "";
}

/**
 * The rendered sentence for `key` with `count` inserted.
 *
 * A counting key has no value of its own in json — only `icalImported_one` and
 * `icalImported_other` do — so a plain lookup of `icalImported` returns `""`.
 * That empty string is why this helper exists rather than reusing `sætning`:
 * `getByText("")` matches every element in the document, so the failure shows
 * up as "found multiple elements" instead of as the missing translation it is.
 */
function medTal(lang: Lang, suffix: "_one" | "_other", count: number): string {
  return sætning(lang, `integrations.icalImported${suffix}`).replace(
    "{{count}}",
    String(count),
  );
}

/**
 * Every language must render something, and never the same sentence twice —
 * a copy-paste that leaves `de` showing English would otherwise pass, because
 * the assertion below only checks that *a* translation appeared.
 */
const FORSKELLIGE = (nøgler: string[]) =>
  ALLE_LANG.map((lang) =>
    nøgler.map((nøgle) => sætning(lang, nøgle)).join("|"),
  );

beforeEach(() => {
  synkResultat = 0;
  synkFejl = false;
  // `ContextDiagnostics` har en fire sekunders nedtæller, så DOM'en skal have
  // hele det klokkeslæt for at nå frem til sit resultat.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await i18n.changeLanguage("da");
});

describe("indstillinger læses på alle fem sprog", () => {
  it("privatlivssiden skriver sine fire afsnit i brugerens sprog", async () => {
    const NØGLER = [
      "privacy.incognitoLabel",
      "privacy.incognitoDesc",
      "privacy.exclusionRulesDesc",
      "privacy.contextLabel",
      "privacy.contextDesc",
    ];

    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      render(<PrivacySettings />);

      for (const nøgle of NØGLER) {
        expect(
          screen.getByText(sætning(lang, nøgle)),
          `${lang}: ${nøgle}`,
        ).toBeTruthy();
      }
      cleanup();
    }

    // De fem sprog må ikke vise den samme sætning — en uoversat streng, der
    // bare blev kopieret til alle sprogene, ville være grøn ovenfor.
    const sætninger = new Set(FORSKELLIGE(NØGLER));
    expect(sætninger.size).toBe(ALLE_LANG.length);
  });

  it("kontekst-diagnosen skriver sin knap og sit resultat i sprog", async () => {
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      const { unmount } = render(<ContextDiagnostics />);

      expect(
        screen.getByRole("button", {
          name: sætning(lang, "privacy.contextTestButton"),
        }),
        `${lang}: knappen`,
      ).toBeTruthy();

      // Kør testen, så «ingen kontekst fundet» bliver renderet. Tælleren er
      // fire sekunder, så DOM'en skal have det klokkeslæt — ellers skifter
      // teksten bare fra «skift til din app» til «test kontekst» undervejs.
      fireEvent.click(screen.getByRole("button"));

      // Tælleren er fire sekunder, så DOM'en skal have hele det klokkeslæt,
      // ellers skifter teksten fra «skift til din app» til «test kontekst»
      // undervejs. `Async`-varianten, fordi kallet til Rust er et løfte.
      await vi.advanceTimersByTimeAsync(4_100);

      expect(
        screen.getByText(sætning(lang, "privacy.contextNotFound")),
        `${lang}: resultatet`,
      ).toBeTruthy();
      // Knappen er tilbage til sit udgangsudtryk, altså ikke længere «skift».
      expect(
        screen.getByRole("button", {
          name: sætning(lang, "privacy.contextTestButton"),
        }),
      ).toBeTruthy();
      unmount();
    }
  });

  it("kalenderimporten skriver etiket, knap og resultat i sprog", async () => {
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      const { unmount } = render(<CalendarIntegration />);

      expect(
        screen.getByLabelText(sætning(lang, "integrations.icalLabel")),
        `${lang}: feltet`,
      ).toBeTruthy();
      expect(
        screen.getByText(sætning(lang, "integrations.icalDescription")),
        `${lang}: beskrivelsen`,
      ).toBeTruthy();

      const knap = screen.getByRole("button", {
        name: sætning(lang, "integrations.icalImportButton"),
      });

      // Uden en URL: «Indtast en iCal-URL først».
      fireEvent.click(knap);
      expect(
        screen.getByText(sætning(lang, "integrations.icalUrlRequired")),
        `${lang}: kravet om URL`,
      ).toBeTruthy();

      // Med URL og et resultat: bøjningen af tallet skal også være oversat.
      synkResultat = 1;
      fireEvent.change(
        screen.getByLabelText(sætning(lang, "integrations.icalLabel")),
        {
          target: { value: "https://example.com/ical.ics" },
        },
      );
      fireEvent.click(knap);
      await waitFor(() =>
        expect(
          screen.getByText(medTal(lang, "_one", 1)),
          `${lang}: én begivenhed`,
        ).toBeTruthy(),
      );

      // Og to, så `_other`-formen er med — dansk og tysk kræver «2 …» mod
      // «1 …», og det er præcis den forskel en copy-paste-oversættelse
      // mister.
      synkResultat = 2;
      fireEvent.click(knap);
      await waitFor(() =>
        expect(
          screen.getByText(medTal(lang, "_other", 2)),
          `${lang}: to begivenheder`,
        ).toBeTruthy(),
      );

      // Og nul: da kommer den anden gren, som også er dansk i den gamle kode.
      synkResultat = 0;
      fireEvent.click(knap);
      await waitFor(() =>
        expect(
          screen.getByText(sætning(lang, "integrations.icalUpToDate")),
          `${lang}: ingen nye begivenheder`,
        ).toBeTruthy(),
      );
      unmount();
    }
  });

  it("en kalenderpost uden projekt skriver kalendernøglen, ikke dansk", async () => {
    // `CalendarEntry` skrev «Ingen projekt» i en `??` inde i en JSX-{} — den
    // nøgle, `calendar.noProject`, lå i alle fem sprog hele vejen.
    const post = {
      id: "e1",
      project_id: null,
      project_name: null,
      client_id: "c1",
      client_name: "Kunde",
      description: "Opsætning",
      start_time: "2026-09-30T09:00:00",
      end_time: "2026-09-30T11:00:00",
      duration: 7200,
      date: "2026-09-30",
      is_billable: true,
      notes: null,
      created_at: "2026-09-30T09:00:00",
      updated_at: "2026-09-30T09:00:00",
      source: "manual",
      klippekort_id: null,
      klippekort_deducted_hours: 0,
    };

    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      const { unmount } = render(
        <CalendarEntry
          entry={post as never}
          hourHeight={48}
          startHour={0}
          onClick={() => {}}
        />,
      );

      // Både den synlige etiket og værktøjstippen.
      expect(
        screen.getByText(sætning(lang, "calendar.noProject")),
        `${lang}: etiketten`,
      ).toBeTruthy();
      expect(
        screen.getByTitle(`${sætning(lang, "calendar.noProject")}: Opsætning`),
        `${lang}: værktøjstippen`,
      ).toBeTruthy();
      unmount();
    }
  });
});
