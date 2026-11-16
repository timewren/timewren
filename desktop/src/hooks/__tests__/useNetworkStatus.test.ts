import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { getOfflineMessage, isNetworkError } from "../useNetworkStatus";

/**
 * De strenge her er kopieret fra `src-tauri/src/ai/*.rs` + `src-tauri/src/i18n.rs`:
 * `error.connectionError` er "{0} forbindelsesfejl: {1}", og `{1}` er
 * reqwest's egen `to_string()`. En håndskrevet "fetch failed" ville være
 * lettere at gøre grøn, men ville ikke dømme det, brugeren faktisk møder.
 */
const DNS_FEJL =
  "OpenAI forbindelsesfejl: error sending request for url (https://api.openai.com/v1/chat/completions): client error (Connect): tcp connect error: dns error: failed to lookup address information: Name or service not known";
const NÆVNET_NÆGTET =
  "Forbindelsesfejl: error sending request for url (https://timetrack.dk/api/desktop/sync): client error (Connect): tcp connect error: Connection refused";
const SYNSK_FEJL = "Kunne ikke synkronisere: adgangskoden er ugyldig";

afterEach(async () => {
  await i18n.changeLanguage("da");
});

describe("isNetworkError", () => {
  it("kender de to fejl Rust faktisk sender ved manglende internet", () => {
    expect(isNetworkError(DNS_FEJL)).toBe(true);
    expect(isNetworkError(NÆVNET_NÆGTET)).toBe(true);
  });

  it("kender fejlen uanset hvilket sprog Rust oversætter den til", () => {
    // Rust oversætter kun `error.connectionError` til dansk og engelsk — `t_nb`
    // og `t_de` falder tilbage på dansk, så en norsk og en tysk bruger læser
    // dansk. Den danske indikator skal derfor dømme lige så hårdt som den
    // engelske, ellers får de to netop de rå kæder, opgaven fjerner.
    expect(
      isNetworkError(
        "OpenAI forbindelsesfejl: error sending request for url (https://api.openai.com/v1/chat/completions)",
      ),
    ).toBe(true);
    expect(
      isNetworkError("OpenAI connection error: error sending request for url"),
    ).toBe(true);
  });

  it("lader en fejl, brugeren skal læse, være en fejl", () => {
    expect(isNetworkError(SYNSK_FEJL)).toBe(false);
    expect(isNetworkError("401 Unauthorized")).toBe(false);
    // En fejl der handler om data, ikke forbindelse, skal læses som den er.
    expect(
      isNetworkError("Kunne ikke synkronisere: 2 aktiviteter mangler projekt"),
    ).toBe(false);
  });

  it("lader Rust's egen timeout-råd stå, det er bedre end offline-teksten", () => {
    // `error.ollamaTimeoutTrySmaller` fra `src-tauri/src/i18n.rs:75`. Den
    // indeholder "timeout", så udenUndtagelsen ville en bruger med en
    // langsom — men virkende — forbindelse få "prøv igen senere" i stedet
    // for "prøv en mindre model".
    const OLLAMA_TIMEOUT =
      "Ollama timeout — svaret tog for lang tid (>60 sek). Prøv en mindre model. (http://localhost:11434)";
    expect(isNetworkError(OLLAMA_TIMEOUT)).toBe(false);
    expect(
      isNetworkError(
        "Ollama timeout — response took too long (>60 sec). Try a smaller model. (http://localhost:11434)",
      ),
    ).toBe(false);
    // En rå kæde fra reqwest har aldrig vores em-dash-sætning, så den er
    // stadig en forbindelsesfejl.
    expect(
      isNetworkError(
        "Ollama: error sending request for url (http://localhost:11434)",
      ),
    ).toBe(true);
  });

  it("dømmer også et Error-objekt, ikke kun strenge", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("noget andet"))).toBe(false);
  });
});

describe("getOfflineMessage", () => {
  it("giver appens sprog, ikke altid dansk", async () => {
    await i18n.changeLanguage("de");
    expect(getOfflineMessage("ai")).toBe(
      "KI-Dienst ist nicht verfügbar — bitte versuchen Sie es später erneut",
    );
    expect(getOfflineMessage("sync")).toContain("Offline");

    await i18n.changeLanguage("sv");
    expect(getOfflineMessage("ai")).toBe(
      "AI-tjänsten är inte tillgänglig — försök igen senare",
    );
  });

  it("kender alle fire kontekster plus en reserve", async () => {
    for (const kontekst of ["ai", "sync", "billy", "license", "noget-ukendt"]) {
      const sætning = getOfflineMessage(kontekst);
      expect(sætning.length).toBeGreaterThan(0);
      // En rå nøgle ville være det eneste, der afslører en manglende
      // oversættelse — den må aldrig nå brugeren.
      expect(sætning).not.toMatch(/^[a-z]+\.[A-Za-z]+$/);
    }
    expect(getOfflineMessage("billy")).toBe(
      "Kunne ikke forbinde til Billy — tjek din internetforbindelse.",
    );
  });
});
