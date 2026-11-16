import { describe, expect, it, vi } from "vitest";
import {
  adoptMessage,
  rememberSession,
  sessionField,
  writeOutcome,
} from "./timer-session";

describe("writeOutcome", () => {
  it("et almindeligt svar er landet", () => {
    expect(writeOutcome({ sessionId: "s", sessionMismatch: false })).toBe(
      "landed",
    );
    expect(writeOutcome(undefined)).toBe("landed");
  });

  it("klassificerer afvisningerne", () => {
    expect(writeOutcome({ sessionMismatch: true })).toBe("session_mismatch");
    expect(writeOutcome({ stoppingInProgress: true })).toBe("stopping");
    expect(writeOutcome({ startRejected: "already_running" })).toBe(
      "start_rejected",
    );
    expect(writeOutcome({ deduplicated: true })).toBe("deduplicated");
  });
});

describe("sessionField", () => {
  it("sender kun et kendt id", () => {
    expect(sessionField("abc")).toEqual({ sessionId: "abc" });
    expect(sessionField(null)).toEqual({});
    expect(sessionField(undefined)).toEqual({});
  });
});

describe("adoptMessage", () => {
  it("har en besked for hver afvisning, men ingen for en landet skrivning", () => {
    expect(adoptMessage("landed")).toBeNull();
    expect(adoptMessage("deduplicated")).toBeNull();
    expect(adoptMessage("session_mismatch")).toMatch(/anden browser/);
    expect(adoptMessage("start_rejected", "paused_session")).toMatch(/pauset/);
  });
});

describe("rememberSession (#C13)", () => {
  it("skriver kun, når sessionen ændres", async () => {
    const storage = new Map<string, unknown>();
    const set = vi.fn(async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) storage.set(k, v);
    });
    const remove = vi.fn(async (keys: string[]) => {
      for (const k of keys) storage.delete(k);
    });
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: async (keys: string[]) =>
            Object.fromEntries(
              keys
                .filter((k) => storage.has(k))
                .map((k) => [k, storage.get(k)]),
            ),
          set,
          remove,
        },
      },
    });
    await rememberSession({ sessionId: "a" });
    await rememberSession({ sessionId: "a" });
    expect(set).toHaveBeenCalledTimes(1);
    await rememberSession({ sessionId: "b" });
    expect(set).toHaveBeenCalledTimes(2);
    await rememberSession({ sessionId: null });
    await rememberSession({ sessionId: null });
    expect(remove).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
