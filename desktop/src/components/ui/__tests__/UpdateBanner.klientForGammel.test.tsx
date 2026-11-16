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

/**
 * Serveren (web #781) afviser skrivninger fra en for gammel desktop-version
 * med HTTP 426 `CLIENT_TOO_OLD`. Rust sætter markøren foran fejlteksten; her
 * dømmes kæden derfra: butikken ser afvisningen, beholder køen, og banneret
 * viser prompten og starter updater-tjekket med det samme — ikke efter 5 s.
 */

const KLIENT_FOR_GAMMEL_FEJL =
  "CLIENT_TOO_OLD: Din TimeTrack-app er for gammel — opdatér for at fortsætte. Dine ændringer ligger sikkert lokalt.";

let opdatering: unknown = null;
let syncSvar: unknown = null;
let syncFejl: unknown = null;
const kald: string[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    kald.push(cmd);
    if (cmd === "check_for_update") return opdatering;
    if (cmd === "sync_full") return syncSvar;
    if (cmd === "sync_now") {
      if (syncFejl) throw syncFejl;
      return syncSvar;
    }
    return null;
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

import { erKlientForGammel, udenKlientMarkoer } from "@/lib/klientVersion";
import { useSyncStore } from "@/stores/syncStore";
import { UpdateBanner } from "../UpdateBanner";

function svar(over: Record<string, unknown> = {}) {
  return {
    pushed: 0,
    pulled: 0,
    conflicts: 0,
    server_time: "2026-10-03T10:00:00.000Z",
    afvist: 0,
    afvisning: null,
    i_koen: 3,
    ...over,
  };
}

beforeEach(() => {
  kald.length = 0;
  opdatering = null;
  syncSvar = svar();
  syncFejl = null;
  useSyncStore.setState({
    isLoggedIn: true,
    isSyncing: false,
    error: null,
    klientForGammel: false,
  });
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("da");
});

describe("klientVersion", () => {
  it("genkender markøren og fjerner den før visning", () => {
    expect(erKlientForGammel(KLIENT_FOR_GAMMEL_FEJL)).toBe(true);
    expect(erKlientForGammel("Push fejlede (500)")).toBe(false);
    expect(erKlientForGammel(new Error("x"))).toBe(false);
    expect(udenKlientMarkoer(KLIENT_FOR_GAMMEL_FEJL)).toMatch(/^Din TimeTrack/);
    expect(udenKlientMarkoer("Push fejlede (500)")).toBe("Push fejlede (500)");
  });
});

describe("syncStore ved for gammel version", () => {
  it("markerer afvist push og beholder køen", async () => {
    syncSvar = svar({
      klient_for_gammel: true,
      afvisning: "Din TimeTrack-app er for gammel — opdatér for at fortsætte.",
    });

    await useSyncStore.getState().syncNow();

    const s = useSyncStore.getState();
    expect(s.klientForGammel).toBe(true);
    expect(s.pendingChanges).toBe(3);
    expect(s.error).toMatch(/for gammel/);
  });

  it("genkender også en fejl fra pull/fuld synk og viser den uden markøren", async () => {
    syncFejl = KLIENT_FOR_GAMMEL_FEJL;

    await useSyncStore.getState().syncNow();

    const s = useSyncStore.getState();
    expect(s.klientForGammel).toBe(true);
    expect(s.error?.startsWith("CLIENT_TOO_OLD")).toBe(false);
  });

  it("en fuld synk (kun pull) lukker ikke advarslen", async () => {
    useSyncStore.setState({ klientForGammel: true });
    await useSyncStore.getState().syncFull();
    expect(useSyncStore.getState().klientForGammel).toBe(true);
  });

  it("en synk uden push lukker ikke advarslen, en push der går igennem gør", async () => {
    useSyncStore.setState({ klientForGammel: true });
    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().klientForGammel).toBe(true);

    syncSvar = svar({ pushed: 2 });
    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().klientForGammel).toBe(false);
  });

  it("en almindelig synk rører ikke flaget", async () => {
    await useSyncStore.getState().syncNow();
    expect(useSyncStore.getState().klientForGammel).toBe(false);
  });
});

describe("UpdateBanner ved for gammel version", () => {
  it("viser prompten og søger straks efter opdateringen", async () => {
    opdatering = { version: "9.8.7", body: null, date: null };
    render(<UpdateBanner />);
    expect(screen.queryByText(da.updates.clientTooOld)).toBeNull();

    await act(async () => {
      useSyncStore.setState({ klientForGammel: true });
    });

    expect(screen.getByText(da.updates.clientTooOld)).toBeTruthy();
    expect(kald).toContain("check_for_update");
    expect(
      await screen.findByRole("button", { name: da.updates.installNow }),
    ).toBeTruthy();
    // Prompten kan ikke lukkes, mens versionen afvises.
    expect(
      screen.queryByRole("button", { name: da.updates.dismiss }),
    ).toBeNull();
  });

  it("viser prompten, selvom updateren ikke fandt en version", async () => {
    render(<UpdateBanner />);
    await act(async () => {
      useSyncStore.setState({ klientForGammel: true });
    });
    expect(screen.getByText(da.updates.clientTooOld)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: da.updates.installNow }),
    ).toBeNull();
    // Ingen blindgyde: brugeren kan søge igen.
    opdatering = { version: "9.8.7", body: null, date: null };
    fireEvent.click(
      await screen.findByRole("button", { name: da.updates.checkButton }),
    );
    expect(
      await screen.findByRole("button", { name: da.updates.installNow }),
    ).toBeTruthy();
  });
});
