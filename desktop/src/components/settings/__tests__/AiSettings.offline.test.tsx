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

/**
 * Hvert `invoke`-kald fanges, så testen kan få backend'en til at svare med det,
 * den skal. `AiSettings` kalder `tauriInvoke`, som går lige til `invoke`.
 */
let svar: Record<string, unknown> = {};
let fejl: Record<string, unknown> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd in fejl) throw fejl[cmd];
    return svar[cmd];
  },
}));

import { AiSettings } from "../AiSettings";

/**
 * Den streng Rust sender, når brugeren trykker "Test forbindelse" uden
 * internet: `error.connectionError` med en reqwest-årsagskæde i `{1}`.
 * Kopieret fra `src-tauri/src/ai/openai.rs:99` + `src-tauri/src/i18n.rs:66`.
 */
const NETVÆRKSFEJL =
  "OpenAI forbindelsesfejl: error sending request for url (https://api.openai.com/v1/chat/completions): client error (Connect): tcp connect error: dns error: failed to lookup address information: Name or service not known";

/** En fejl brugeren skal læse, fordi den siger noget om nøglen. */
const NØGLEFEJL = "OpenAI: 401 Unauthorized — api key";

const STEN = { normalizer: (tekst: string) => tekst.trim() } as const;

beforeEach(() => {
  svar = {
    get_ai_config: { provider: "openai", apiKey: "sk-test", model: "gpt-4o" },
    list_rules: [],
    list_projects: [],
  };
  fejl = {};
});

afterEach(async () => {
  cleanup();
  svar = {};
  fejl = {};
  await i18n.changeLanguage("da");
});

describe("AI-testknappen", () => {
  it("viser den oversatte sætning, når der ikke er internet", async () => {
    fejl.test_ai_connection = NETVÆRKSFEJL;
    render(<AiSettings />);

    fireEvent.click(screen.getByText(da.ai.testConnection));

    // Dansk: den sætning, der lå i `getOfflineMessage` som hårdkodet dansk.
    await waitFor(() =>
      expect(
        screen.getByText(
          "AI-tjenesten er ikke tilgængelig — prøv igen senere",
          STEN,
        ),
      ).toBeDefined(),
    );
    // Beviset: årsagskæden fra Rust må ikke stå i DOM'en.
    expect(document.body.textContent).not.toContain("tcp connect error");
    expect(document.body.textContent).not.toContain("forbindelsesfejl");
  });

  it("følger appens sprog, også når der ikke er internet", async () => {
    fejl.test_ai_connection = NETVÆRKSFEJL;
    await i18n.changeLanguage("de");
    render(<AiSettings />);

    fireEvent.click(screen.getByText(de.ai.testConnection));

    await waitFor(() =>
      expect(
        screen.getByText(
          "KI-Dienst ist nicht verfügbar — bitte versuchen Sie es später erneut",
          STEN,
        ),
      ).toBeDefined(),
    );
  });

  it("lader en fejl, der handler om nøglen, stå, så den kan læses", async () => {
    fejl.test_ai_connection = NØGLEFEJL;
    render(<AiSettings />);

    fireEvent.click(screen.getByText(da.ai.testConnection));

    await waitFor(() =>
      expect(screen.getByText(NØGLEFEJL, STEN)).toBeDefined(),
    );
  });
});
