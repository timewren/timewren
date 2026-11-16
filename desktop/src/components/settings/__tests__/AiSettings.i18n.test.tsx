import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassificationRule } from "@/components/settings/RuleDialog";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

const invoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

import { AiSettings } from "../AiSettings";

/**
 * AI-indstillingerne havde otte strenge i koden, som tekstporten dømmer, men
 * som ingen oversættelsesnøgle dækkede. Tre af dem var dansk, en tysk eller
 * norsk bruger læste på den skærm hvor de vælger AI-udbyder, skriver API-nøgle
 * og læser deres klassificeringsregler:
 *
 * 1. **`Ollama (lokal)`** lå som et produktnavn i `PROVIDERS`, men «(lokal)» er
 *    et dansk ord ved siden af navnet — det er den eneste udbyder, hvor der
 *    står mere end et navn. Nøglen `ai.providerOllama` fandtes i alle fem
 *    locales og blev **aldrig brugt**.
 * 2. **`placeholder="sk-..."`** er et engelsk nøgleformat, ikke dansk, men det
 *    er heller ikke det, feltet skal sige: brugeren skal vide at det er en
 *    API-nøgle. `ai.apiKeyPlaceholder` fandtes i alle fem locales, ubrugt.
 * 3. **`&quot;`** omgav regelens betingelsesværdi med danske tegn fra
 *    JSX-markup'en. Tysker bruger „…“, så citationstegnene hører til sætningen
 *    — ny nøgle `ai.ruleCondition`, der også samler de to dele, der lå løst
 *    mellem hinanden med `{" "}`.
 *
 * De fem resterende er **produktnavne** (`OpenAI`, `Ordbogen.ai`), der hedder
 * det samme på alle fem sprog. Undtagelseslisten sagde «dansk tekst, endnu ikke
 * oversat» om dem, hvilket er forkert — den slags forkerte begrundelser er det,
 * der får næste iteration til at lede efter dansk, der ikke er der.
 *
 * Testen skifter sprog og dømmer DOM'en, fordi `fallbackLng: "da"` ellers gør
 * en manglende nøgle usynlig: `t()` svarer med dansk, og skærmen ser rigtig ud.
 */
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

/** Nøglen → den sætning brugeren skal se. */
function value(lang: Lang, key: string) {
  return TABLES[lang].get(key) ?? "";
}

/** Den betingelseslinje en regel viser, bygget af de nøgler skærmen læser. */
function betingelse(lang: Lang) {
  const mønster = value(lang, "ai.ruleCondition");
  return mønster
    .replace("{{type}}", value(lang, "ai.conditionAppName"))
    .replace("{{op}}", value(lang, "ai.opContains"))
    .replace("{{value}}", "VS Code");
}

const REGEL: ClassificationRule = {
  id: 1,
  name: "Udvikling",
  condition_type: "app_name",
  condition_op: "contains",
  condition_value: "VS Code",
  target_category: null,
  target_project_id: null,
  is_active: true,
  priority: 0,
  created_at: "",
  updated_at: "",
} as unknown as ClassificationRule;

/** `provider` styrer hvilke felter skærmen overhovedet viser. */
let provider = "ollama";

async function aabn(lang: Lang) {
  cleanup();
  await i18n.changeLanguage(lang);
  const { container } = render(<AiSettings />);
  await waitFor(() => expect(container.textContent ?? "").not.toBe(""));
  return container;
}

beforeEach(() => {
  provider = "ollama";
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "get_ai_config")
      return Promise.resolve({
        provider,
        api_key: null,
        model: null,
        base_url: null,
      });
    if (cmd === "list_rules") return Promise.resolve([REGEL]);
    if (cmd === "list_projects") return Promise.resolve([]);
    return Promise.resolve(null);
  });
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("da");
});

describe("AI-indstillingerne følger appens sprog", () => {
  it("har en egen værdi for hver nøgle i alle 5 sprog", () => {
    // `fallbackLng: "da"` gør en manglende nøgle usynlig, så json'en dømmes
    // direkte: en nøgle der mangler et sted har her en tom værdi.
    for (const lang of ALLE_LANG) {
      for (const noegle of [
        "ai.providerOllama",
        "ai.apiKeyPlaceholder",
        "ai.ruleCondition",
      ]) {
        expect(value(lang, noegle), `${lang}:${noegle}`).not.toBe("");
        expect(value(lang, noegle), `${lang}:${noegle}`).not.toBe(noegle);
      }
    }
  });

  it("viser «(lokal)» i det valgte sprog i både knap og liste", async () => {
    // Knappen viser den valgte udbyder, listen alle seks. Begge veje skal bruge
    // nøglen, ellers står «Ollama (lokal)» stadig i den ene.
    for (const lang of ALLE_LANG) {
      const container = await aabn(lang);
      const knap = screen.getByRole("button", {
        name: value(lang, "ai.selectProvider"),
      });
      expect(knap.textContent, `${lang}:knap`).toContain(
        value(lang, "ai.providerOllama"),
      );

      fireEvent.click(knap);
      const liste = screen
        .getAllByRole("button")
        .filter((b) => b.textContent?.includes("Ollama"));
      expect(liste.length, `${lang}:liste`).toBeGreaterThan(0);
      for (const knap2 of liste) {
        expect(knap2.textContent, `${lang}:liste`).toContain(
          value(lang, "ai.providerOllama"),
        );
      }
      // Luk listen igen, så næste sprog ikke renderer oven på den.
      fireEvent.click(knap);
      expect(container).toBeTruthy();
    }
  });

  it("skriver aldrig den danske udbydertekst i et andet sprog", async () => {
    // Ellers ville testen ovenfor være grøn fordi `fallbackLng` serverede dansk
    // i stedet for en manglende nøgle. Sprog hvor «lokal» *er* det rigtige ord
    // (svensk, norsk, tysk) dømmes ikke her — der er dansk og oversættelse ens.
    for (const lang of ALLE_LANG) {
      if (lang === "da") continue;
      if (value(lang, "ai.providerOllama") === value("da", "ai.providerOllama"))
        continue;
      const container = await aabn(lang);
      fireEvent.click(
        screen.getByRole("button", { name: value(lang, "ai.selectProvider") }),
      );
      expect(
        (container.textContent ?? "").includes(
          value("da", "ai.providerOllama"),
        ),
        `${lang}: dansk udbydertekst overlevde`,
      ).toBe(false);
    }
  });

  it("siger i felterne at der skal indtastes en API-nøgle, på sproget", async () => {
    // Feltets pladsholder lå som «sk-...», et nøgleformat. Det er ikke dansk,
    // men det er heller ikke det, brugeren skal have at vide — de skal vide at
    // det er en API-nøgle. Kun en udbyder med nøgle viser feltet.
    provider = "openai";
    for (const lang of ALLE_LANG) {
      const container = await aabn(lang);
      const felt = container.querySelector<HTMLInputElement>(
        'input[type="password"]',
      );
      expect(felt, `${lang}:feltet findes ikke`).toBeTruthy();
      expect(felt?.getAttribute("placeholder"), `${lang}`).toBe(
        value(lang, "ai.apiKeyPlaceholder"),
      );
    }
  });

  it("afsiger aldrig den danske eller engelske pladsholder i et andet sprog", async () => {
    // To ting der lå i feltet før: den danske «API-nøgle...» og nøgleformatet
    // «sk-...». Den anden er ikke dansk, men den er stadig det, der lå der —
    // så begge dømmes, ellers kunne feltet falde tilbage til den tavse værdi.
    provider = "openai";
    for (const lang of ALLE_LANG) {
      if (lang === "da") continue;
      if (
        value(lang, "ai.apiKeyPlaceholder") ===
        value("da", "ai.apiKeyPlaceholder")
      )
        continue;
      const container = await aabn(lang);
      const markup = container.innerHTML ?? "";
      for (const forbudt of [value("da", "ai.apiKeyPlaceholder"), "sk-..."]) {
        expect(
          markup.includes(forbudt),
          `${lang}: «${forbudt}» overlevde`,
        ).toBe(false);
      }
    }
  });

  it("sætter regelens betingelse sammen med sprogets citationstegn", async () => {
    // Regellinjen lå som tre løse dele med `{" "}` imellem og `&quot;` om
    // værdien. Nu kommer den fra én nøgle, så tysker læser „VS Code“ og ikke
    // `"VS Code"` — og en dansk bruger ser præcis det, han så før.
    for (const lang of ALLE_LANG) {
      const container = await aabn(lang);
      const linje = [...container.querySelectorAll("p")].find((p) =>
        (p.textContent ?? "").includes("VS Code"),
      );
      expect(linje, `${lang}:regellinjen findes ikke`).toBeTruthy();
      expect((linje?.textContent ?? "").trim(), `${lang}`).toBe(
        betingelse(lang),
      );
    }
  });

  it("viser brugerens egen værdi i betingelsen, ikke en oversat kopi", async () => {
    // `condition_value` er det brugeren har skrevet — en regex, et app-navn, en
    // URL. Den skal vises ordret, kun omgivet af citationstegn.
    const container = await aabn("da");
    const linje = [...container.querySelectorAll("p")].find((p) =>
      (p.textContent ?? "").includes("VS Code"),
    );
    expect(linje?.textContent).toContain('"VS Code"');
  });
});
