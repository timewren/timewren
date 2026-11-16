import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

/**
 * Sentry sendes derfra, `sendFeedback` svarer med om rapporten gik, og
 * `isSentryActive` afgør om den gule advarsel vises. Uden mocken rammer testen
 * den rigtige klient, hvor svaret altid er `false` — succesvejen kunne aldrig
 * prøves. `h` er ét objekt, så både mocken og testene rører samme tilstand.
 */
const h = vi.hoisted(() => ({
  aktiv: true,
  kald: [] as { category: string; message: string; email?: string }[],
}));

vi.mock("@/lib/sentry", () => ({
  isSentryActive: () => h.aktiv,
  sendFeedback: (input: {
    category: string;
    message: string;
    email?: string;
  }) => {
    h.kald.push(input);
    return h.aktiv;
  },
}));

import { useToastStore } from "@/stores/toastStore";
import { FeedbackButton } from "../FeedbackButton";

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

function value(lang: Lang, key: string) {
  return TABLES[lang].get(key) ?? "";
}

const UØRET = { normalizer: (tekst: string) => tekst.trim() } as const;

/** Tekstnoder i dialogen, når fejlrapportering er slået *til*. */
const I_DIALOGEN = [
  "common.cancel",
  "feedback.send",
  "feedback.intro",
  "feedback.category",
  "feedback.categoryBug",
  "feedback.categoryRequest",
  "feedback.categoryOther",
  "common.description",
  "feedback.emailLabel",
] as const;

/** Pladsholdere er deres egne attributter, så de dømmes for sig selv. */
const PLADSHOLDERE = [
  "feedback.descriptionPlaceholder",
  "feedback.emailPlaceholder",
] as const;

/** Kun synlig når Sentry er slået fra — dømmes i sin egen test. */
const KUN_NÅR_FRA = "feedback.disabledNote";

/**
 * Nøgler der med vilje ligner dansk i alle sprog: `Type` hedder det samme på
 * dansk, engelsk og norsk. De afviger ikke fra dansk, så afvigelsestesten
 * springer dem over — de får derfor deres egen dømning.
 */
const ENS_I_DANMARK = ["feedback.category", "feedback.send"] as const;

/**
 * De tre `value`s i `CATEGORIES` står på linjen i dansk, men er ikke synlige:
 * de er det `[Mangel/ønske]` der står i rapporten. De dømmes derfor ikke som
 * UI-tekst, men `fastholder den danske kategori` dømmer at de overlever.
 */
const RAPPORT_VÆRDIER = ["Fejl", "Mangel/ønske", "Andet"] as const;

function findAlle(tekst: string) {
  return screen.queryAllByText(tekst, UØRET);
}

function manglende(lang: Lang, nøgler: readonly string[]): string[] {
  return nøgler.filter((key) => findAlle(value(lang, key)).length === 0);
}

function toasts() {
  return useToastStore.getState().toasts;
}

function aabnDialog() {
  // Efter en send er dialogen lukket, men knappen står stadig i sidebaren med
  // præcis samme ord som dialogens overskrift — derfor søges på rollen, så
  // gentagne åbninger ikke rammer den forkert.
  fireEvent.click(
    screen.getByRole("button", {
      name: value(i18n.language as Lang, "feedback.trigger"),
    }),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
}

function skrivBeskrivelse(tekst = "Knappen virker ikke") {
  fireEvent.change(
    screen.getByPlaceholderText(
      value(i18n.language as Lang, "feedback.descriptionPlaceholder"),
      UØRET,
    ),
    { target: { value: tekst } },
  );
}

function kategori() {
  return screen.getByLabelText(
    value(i18n.language as Lang, "feedback.category"),
  ) as HTMLSelectElement;
}

function send() {
  fireEvent.click(
    screen.getByText(value(i18n.language as Lang, "feedback.send"), UØRET),
  );
}

beforeEach(() => {
  h.aktiv = true;
  h.kald.length = 0;
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  cleanup();
  h.aktiv = true;
  h.kald.length = 0;
  useToastStore.setState({ toasts: [] });
  await i18n.changeLanguage("da");
});

/**
 * "Indberet fejl eller mangel" lå i sidebaren på alle 5 sprog med 13 danske
 * strenge i dialogen oven i. Det er den vej en svensk eller tysk bruger har til
 * at få en fejl rettet, så han skulle skrive dansk for at fortelle hvad der er
 * galt — og de to strenge der *nævner hvor fejlrapportering slås fra*, er de
 * veje hen til den indstilling der skal slås til.
 */
describe("Indberetningsknappen følger appens sprog", () => {
  it("viser dansk på dansk", () => {
    render(<FeedbackButton />);
    aabnDialog();

    expect(manglende("da", I_DIALOGEN)).toEqual([]);
    for (const key of PLADSHOLDERE) {
      expect(
        screen.getByPlaceholderText(value("da", key), UØRET),
        key,
      ).toBeTruthy();
    }
  });

  for (const lang of ANDRE_LANG) {
    it(`viser ${lang} i stedet for dansk`, async () => {
      await i18n.changeLanguage(lang);
      render(<FeedbackButton />);
      aabnDialog();

      const afvigendeTekst = I_DIALOGEN.filter(
        (key) => value(lang, key) !== value("da", key),
      );
      const afvigendePladsholder = PLADSHOLDERE.filter(
        (key) => value(lang, key) !== value("da", key),
      );

      // Uden dette tælling ville testen være grøn, hvis visningen bare var
      // blevet tom. Norsk ligger tættest på dansk — "Type", "Send" og "Mangel
      // eller ønske" er de samme ord — så 5 er det laveste, alle har.
      expect(afvigendeTekst.length).toBeGreaterThanOrEqual(5);
      expect(afvigendePladsholder.length).toBe(2);
      expect(manglende(lang, afvigendeTekst)).toEqual([]);

      // Og ingen dansk fra markup'en må overleve i et ikke-dansk sprog.
      const danske = afvigendeTekst.filter(
        (key) => findAlle(value("da", key)).length > 0,
      );
      expect(danske).toEqual([]);

      for (const key of PLADSHOLDERE) {
        expect(
          screen.queryByPlaceholderText(value(lang, key), UØRET),
          key,
        ).not.toBeNull();
      }
      for (const key of afvigendePladsholder) {
        expect(
          screen.queryByPlaceholderText(value("da", key), UØRET),
          key,
        ).toBeNull();
      }
    });
  }

  it("dømmer hver nøgle i alle 5 sprog mod json'en", async () => {
    // `fallbackLng: "da"` gør en manglende nøgle usynlig: `t()` svarer med
    // dansk, og skærmen ser rigtig ud. Derfor dømmes json'en direkte i stedet
    // for at sammenligne med dansk — en nøgle der mangler i et sprog har en
    // tom værdi her, og testen stopper med det.
    for (const lang of ALLE_LANG) {
      cleanup();
      h.kald.length = 0;
      await i18n.changeLanguage(lang);
      render(<FeedbackButton />);
      aabnDialog();

      for (const key of I_DIALOGEN) {
        expect(value(lang, key), `${lang}:${key}`).not.toBe("");
        expect(manglende(lang, [key]), `${lang}:${key}`).toEqual([]);
      }
      for (const key of PLADSHOLDERE) {
        expect(value(lang, key), `${lang}:${key}`).not.toBe("");
        expect(
          screen.queryByPlaceholderText(value(lang, key), UØRET),
          `${lang}:${key}`,
        ).not.toBeNull();
      }
    }
  });

  it("dømmer også de nøgler der med vilje ligner dansk", async () => {
    // Ellers er de ubevidste ubevogtede: de afviger ikke fra dansk, så hverken
    // afvigelsestesten eller json-gennemgangen dømmer dem.
    for (const key of ENS_I_DANMARK) {
      for (const lang of ALLE_LANG) {
        cleanup();
        await i18n.changeLanguage(lang);
        render(<FeedbackButton />);
        aabnDialog();
        expect(manglende(lang, [key]), `${lang}:${key}`).toEqual([]);
      }
    }
  });

  it("siger på brugerens sprog at indberetningen er sendt", async () => {
    for (const lang of ALLE_LANG) {
      cleanup();
      useToastStore.setState({ toasts: [] });
      h.kald.length = 0;
      await i18n.changeLanguage(lang);
      render(<FeedbackButton />);
      aabnDialog();
      skrivBeskrivelse();

      send();
      expect(toasts(), lang).toHaveLength(1);
      expect(toasts()[0].message).toBe(value(lang, "feedback.sent"));
      expect(toasts()[0].type).toBe("success");
      expect(h.kald, lang).toEqual([
        { category: "Fejl", message: "Knappen virker ikke", email: "" },
      ]);
    }
  });

  it("sager på brugerens sprog at fejlrapportering er slået fra", async () => {
    // Det er den eneste vej brugeren får at vide hvorfor intet sker, og den
    // nævner selv den indstilling der skal slås til. Begge dele skal være
    // oversat — ellers står der dansk oven på en advarsel om dansk.
    for (const lang of ALLE_LANG) {
      cleanup();
      useToastStore.setState({ toasts: [] });
      h.kald.length = 0;
      h.aktiv = false;
      await i18n.changeLanguage(lang);
      render(<FeedbackButton />);
      aabnDialog();

      // Den gule advarsel står i dialogen med det samme.
      expect(manglende(lang, [KUN_NÅR_FRA]), `${lang}:${KUN_NÅR_FRA}`).toEqual(
        [],
      );

      skrivBeskrivelse();
      send();
      expect(toasts(), lang).toHaveLength(1);
      expect(toasts()[0].message).toBe(value(lang, "feedback.disabledToast"));
      expect(toasts()[0].type).toBe("error");

      // Og dialogen bliver stående, så beskrivelsen ikke er spildt.
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(
        screen.getByPlaceholderText(
          value(lang, "feedback.descriptionPlaceholder"),
          UØRET,
        ),
      ).toBeTruthy();
    }
  });

  it("viser advarslen kun når fejlrapportering faktisk er slået fra", () => {
    // Ellers kunne den være en permanent dansk (eller tysk) advarsel oven på en
    // dialog der ellers virker — og ingen port ville se den, fordi ingen
    // `toast` og ingen `set*`-sætter hver den.
    render(<FeedbackButton />);
    aabnDialog();
    expect(manglende("da", [KUN_NÅR_FRA])).toEqual([KUN_NÅR_FRA]);

    cleanup();
    h.aktiv = false;
    render(<FeedbackButton />);
    aabnDialog();
    expect(manglende("da", [KUN_NÅR_FRA])).toEqual([]);
  });

  it("fastholder den danske kategori i rapporten", async () => {
    // `CATEGORIES` er et modul-kort med danske værdier, som ingen port dømmer.
    // Værdierne er det `[Mangel/ønske]` der står i rapporten, og en Sentry-
    // alarmregel kan sortere på det — så de må ikke oversættes, kun
    // etiketterne må det. Derfor dømmes de her, i alle 5 sprog.
    for (const lang of ALLE_LANG) {
      cleanup();
      h.kald.length = 0;
      await i18n.changeLanguage(lang);
      render(<FeedbackButton />);
      aabnDialog();

      const select = kategori();
      expect(
        Array.from(select.options).map((o) => o.value),
        lang,
      ).toEqual([...RAPPORT_VÆRDIER]);
      expect(
        Array.from(select.options).map((o) => o.textContent?.trim()),
        lang,
      ).toEqual([
        value(lang, "feedback.categoryBug"),
        value(lang, "feedback.categoryRequest"),
        value(lang, "feedback.categoryOther"),
      ]);

      fireEvent.change(select, { target: { value: "Mangel/ønske" } });
      skrivBeskrivelse("Dropper tiden på pause");
      send();
      expect(h.kald, lang).toEqual([
        {
          category: "Mangel/ønske",
          message: "Dropper tiden på pause",
          email: "",
        },
      ]);
    }
  });

  it("nulstiller kategorien til den første efter en send", async () => {
    // `setCategory("Fejl")` blev til `setCategory(CATEGORIES[0].value)`, fordi
    // den danske streng så lå to steder. Hvis de to kan glide fra hinanden, står
    // selectet på en værdi uden etiket — brugeren ser en tom linje efter hver
    // indberetning.
    for (const lang of ALLE_LANG) {
      cleanup();
      h.kald.length = 0;
      await i18n.changeLanguage(lang);
      render(<FeedbackButton />);
      aabnDialog();

      fireEvent.change(kategori(), { target: { value: "Andet" } });
      skrivBeskrivelse();
      send();
      expect(h.kald[0]?.category, lang).toBe("Andet");

      aabnDialog();
      const efter = kategori();
      expect(efter.value, lang).toBe("Fejl");
      // Værdien skal have en etiket i det sprog, der står i.
      expect(
        efter.options[efter.selectedIndex]?.textContent?.trim(),
        lang,
      ).toBe(value(lang, "feedback.categoryBug"));
    }
  });

  it("sender ikke en tom beskrivelse", () => {
    // Knappen er deaktiveret, så en indberetning uden indhold ikke kan sendes —
    // den ville komme ud som `[Fejl] ` i rapporten.
    render(<FeedbackButton />);
    aabnDialog();
    const knap = screen.getByText(
      value("da", "feedback.send"),
      UØRET,
    ) as HTMLButtonElement;
    expect(knap.disabled).toBe(true);

    skrivBeskrivelse("   ");
    send();
    expect(h.kald).toEqual([]);
    expect(toasts()).toEqual([]);
  });
});
