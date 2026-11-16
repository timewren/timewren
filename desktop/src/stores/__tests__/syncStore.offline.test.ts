import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";

/**
 * Synk-butikkens fejl er det, brugeren ser, når han trykker på "Synkronisér"
 * ude i en kafé uden wifi. `sync.connectionError` i Rust sender
 * "Forbindelsesfejl: {reqwest-årsag}", og det er den streng, der lå i toasten.
 */
const NETVÆRKSFEJL =
  "Forbindelsesfejl: error sending request for url (https://timetrack.dk/api/desktop/sync): client error (Connect): tcp connect error: Connection refused";

let fejl: Record<string, unknown> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd in fejl) throw fejl[cmd];
    return { server_time: null, pushed: 0, pulled: 0, conflicts: 0 };
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

import { useSyncStore } from "../syncStore";

beforeEach(() => {
  fejl = {};
  useSyncStore.setState({ isLoggedIn: true, isSyncing: false, error: null });
});

afterEach(async () => {
  fejl = {};
  await i18n.changeLanguage("da");
});

describe("syncStore", () => {
  it("siger hvad brugeren kan gøre, når der ikke er internet", async () => {
    fejl.sync_now = NETVÆRKSFEJL;

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().error).toBe(da.errors.syncOffline);
    expect(useSyncStore.getState().isSyncing).toBe(false);
  });

  it("gør det samme for fuld sync", async () => {
    fejl.sync_full = NETVÆRKSFEJL;

    await useSyncStore.getState().syncFull();

    expect(useSyncStore.getState().error).toBe(da.errors.syncOffline);
  });

  it("følger appens sprog", async () => {
    fejl.sync_now = NETVÆRKSFEJL;
    await i18n.changeLanguage("de");

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().error).toBe(de.errors.syncOffline);
  });

  it("lader en fejl, der handler om kontoen, stå, så den kan læses", async () => {
    fejl.sync_now = "Kunne ikke synkronisere: 401 Unauthorized";

    await useSyncStore.getState().syncNow();

    expect(useSyncStore.getState().error).toBe(
      "Kunne ikke synkronisere: 401 Unauthorized",
    );
  });
});
