import { describe, expect, it, vi } from "vitest";
import {
  createLongTimerReminder,
  LONG_TIMER_SECONDS,
} from "../long-timer-reminder";
import {
  createServerConfirmation,
  SERVER_CONFIRMATION_TTL_MS,
} from "../server-confirmation";

const HOUR = 3600;
const NOW = Date.parse("2026-11-24T09:00:00Z");

/**
 * Påmindelsen koblet til en rigtig serverbekræftelse, som timerbjælken gør
 * det. Fanens timer har også sin lokale elapsedTime med: påmindelsen må
 * ikke kunne bruge den.
 */
function reminderSetup() {
  const show = vi.fn();
  const dismiss = vi.fn();
  const confirmation = createServerConfirmation();
  let now = NOW;
  const reminder = createLongTimerReminder({
    show,
    dismiss,
    storage: () => null,
    confirmation,
    now: () => now,
  });
  reminder.connect();
  const tick = (
    local: { isRunning: boolean; sessionId: string; elapsedTime: number },
    at: number,
  ) => {
    now = at;
    reminder.update({ ...local, key: `k:${local.sessionId}` });
  };
  return { reminder, confirmation, tick, show, dismiss };
}

describe("påmindelse om lang timer kræver serverens bekræftelse (#1324)", () => {
  it("minder ikke om en forældet lokal timer, når serveren kører en frisk", () => {
    const { confirmation, tick, show } = reminderSetup();
    // Fanen fra i går: localStorage siger, at "old" har kørt i 22 timer.
    const local = { isRunning: true, sessionId: "old", elapsedTime: 22 * HOUR };

    // Før afstemningen er landet: ingen bekræftelse, ingen påmindelse.
    tick(local, NOW);
    expect(show).not.toHaveBeenCalled();

    // Afstemningen adopterer serverens timer (startet fra udvidelsen for 3
    // min. siden) og bekræfter den.
    const read = confirmation.beginRead();
    local.sessionId = "new";
    local.elapsedTime = 180;
    confirmation.complete(read, {
      server: { isRunning: true, intent: null, sessionId: "new" },
      serverElapsedSeconds: 180,
      local,
      at: NOW,
    });
    tick(local, NOW + 1000);
    expect(show).not.toHaveBeenCalled();
    expect(confirmation.elapsedSeconds(local, NOW + 1000)).toBe(181);
  });

  it("skjuler en vist påmindelse ved fokus, og den kommer ikke igen for en ny timer", () => {
    const { reminder, confirmation, tick, show, dismiss } = reminderSetup();
    const local = { isRunning: true, sessionId: "old", elapsedTime: 22 * HOUR };
    confirmation.complete(confirmation.beginRead(), {
      server: { isRunning: true, intent: null, sessionId: "old" },
      serverElapsedSeconds: 22 * HOUR,
      local,
      at: NOW,
    });
    tick(local, NOW);
    expect(show).toHaveBeenCalledWith("k:old#1", 22, expect.any(Function));

    // Brugeren stopper "old" og starter en ny timer i udvidelsen, og vender
    // tilbage til fanen. Den har stadig "old" lokalt, til serveren svarer.
    // Påmindelsen og stop-knappen forsvinder straks, uden at vente på et tick.
    expect(reminder.canStop("k:old#1")).toBe(true);
    confirmation.invalidate();
    expect(dismiss).toHaveBeenCalledWith("k:old#1");
    expect(reminder.canStop("k:old#1")).toBe(false);

    const read = confirmation.beginRead();
    local.sessionId = "new";
    local.elapsedTime = 60;
    confirmation.complete(read, {
      server: { isRunning: true, intent: null, sessionId: "new" },
      serverElapsedSeconds: 60,
      local,
      at: NOW + 61_000,
    });
    tick(local, NOW + 62_000);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("følger bekræftelsen uden tick, når fanens elapsed står stille ved loftet", () => {
    const { reminder, confirmation, tick, show, dismiss } = reminderSetup();
    // timerStore holder elapsedTime ved 24 timer: ingen flere ticks.
    const local = { isRunning: true, sessionId: "s1", elapsedTime: 24 * HOUR };
    tick(local, NOW);
    expect(show).not.toHaveBeenCalled();

    confirmation.complete(confirmation.beginRead(), {
      server: { isRunning: true, intent: null, sessionId: "s1" },
      serverElapsedSeconds: 30 * HOUR,
      local,
      at: NOW,
    });
    expect(show).toHaveBeenCalledWith("k:s1#1", 30, expect.any(Function));

    // Fokus, og serversvaret hænger: påmindelsen må ikke blive stående.
    confirmation.invalidate();
    expect(dismiss).toHaveBeenCalledWith("k:s1#1");
    expect(reminder.canStop("k:s1#1")).toBe(false);
  });

  it("minder om en lang timer, når serveren har bekræftet den", () => {
    const { confirmation, tick, show } = reminderSetup();
    const local = { isRunning: true, sessionId: "s1", elapsedTime: 0 };
    confirmation.complete(confirmation.beginRead(), {
      server: { isRunning: true, intent: null, sessionId: "s1" },
      serverElapsedSeconds: 11 * HOUR,
      local,
      at: NOW,
    });
    tick(local, NOW);
    expect(show).toHaveBeenCalledWith("k:s1#1", 11, expect.any(Function));
  });

  it("glemmer bekræftelsen ved fokus, og en læsning fra før fokus tæller ikke", () => {
    const confirmation = createServerConfirmation();
    const local = { isRunning: true, sessionId: "s1" };
    const server = { isRunning: true, intent: null, sessionId: "s1" };
    confirmation.complete(confirmation.beginRead(), {
      server,
      serverElapsedSeconds: LONG_TIMER_SECONDS,
      local,
      at: NOW,
    });
    expect(confirmation.elapsedSeconds(local, NOW)).toBe(LONG_TIMER_SECONDS);

    const staleRead = confirmation.beginRead();
    confirmation.invalidate();
    expect(confirmation.elapsedSeconds(local, NOW)).toBeNull();
    confirmation.complete(staleRead, {
      server,
      serverElapsedSeconds: LONG_TIMER_SECONDS,
      local,
      at: NOW,
    });
    expect(confirmation.elapsedSeconds(local, NOW)).toBeNull();
  });

  it("bekræfter ikke en anden session, en stoppende eller en stoppet timer", () => {
    const confirmation = createServerConfirmation();
    const local = { isRunning: true, sessionId: "s1" };
    const cases = [
      { isRunning: true, intent: null, sessionId: "other" },
      { isRunning: true, intent: "stopping", sessionId: "s1" },
      { isRunning: false, intent: null, sessionId: null },
    ];
    for (const server of cases) {
      confirmation.complete(confirmation.beginRead(), {
        server,
        serverElapsedSeconds: LONG_TIMER_SECONDS,
        local,
        at: NOW,
      });
      expect(confirmation.elapsedSeconds(local, NOW)).toBeNull();
    }
  });

  it("gælder kun den bekræftede session og kun en tid", () => {
    const confirmation = createServerConfirmation();
    const local = { isRunning: true, sessionId: "s1" };
    confirmation.complete(confirmation.beginRead(), {
      server: { isRunning: true, intent: null, sessionId: "s1" },
      serverElapsedSeconds: 60,
      local,
      at: NOW,
    });
    expect(
      confirmation.elapsedSeconds({ isRunning: true, sessionId: "s2" }, NOW),
    ).toBeNull();
    expect(
      confirmation.elapsedSeconds({ isRunning: false, sessionId: "s1" }, NOW),
    ).toBeNull();
    expect(
      confirmation.elapsedSeconds(local, NOW + SERVER_CONFIRMATION_TTL_MS),
    ).toBeNull();
  });
});
