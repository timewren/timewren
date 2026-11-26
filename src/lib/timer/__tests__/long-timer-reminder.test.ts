import { describe, expect, it, vi } from "vitest";
import {
  createLongTimerReminder,
  LONG_TIMER_SECONDS,
  longTimerKey,
} from "../long-timer-reminder";

function fixedConfirmation(seconds: number) {
  return { elapsedSeconds: () => seconds, subscribe: () => () => {} };
}

function setup() {
  const store = new Map<string, string>();
  const show = vi.fn();
  const dismiss = vi.fn();
  // Den serverbekræftede varighed, som påmindelsen læser.
  let confirmed: number | null = null;
  const reminder = createLongTimerReminder({
    show,
    dismiss,
    storage: () => ({
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
    }),
    confirmation: {
      elapsedSeconds: () => confirmed,
      subscribe: () => () => {},
    },
  });
  const update = (state: {
    isRunning: boolean;
    elapsedSeconds: number | null;
    key: string;
  }) => {
    confirmed = state.elapsedSeconds;
    reminder.update({
      isRunning: state.isRunning,
      sessionId: null,
      key: state.key,
    });
  };
  // Toast-id'et for seneste visning af timeren med denne nøgle.
  const toastOf = (key: string): string =>
    show.mock.calls.findLast((c) => String(c[0]).startsWith(`${key}#`))?.[0] ??
    "";
  return { reminder, update, show, dismiss, store, toastOf };
}

const LONG = LONG_TIMER_SECONDS + 5;

describe("longTimerKey", () => {
  it("bruger sessionStartTime først", () => {
    expect(
      longTimerKey({ sessionStartTime: 1, sessionId: "s", startTime: 2 }),
    ).toBe("timetrack:long-timer-reminded:1");
  });

  it("giver to timere uden sessionStartTime hver sin nøgle", () => {
    const a = longTimerKey({
      sessionStartTime: null,
      sessionId: "a",
      startTime: 1,
    });
    const b = longTimerKey({
      sessionStartTime: null,
      sessionId: "b",
      startTime: 2,
    });
    expect(a).not.toBe(b);
    const c = longTimerKey({
      sessionStartTime: null,
      sessionId: null,
      startTime: 3,
    });
    const d = longTimerKey({
      sessionStartTime: null,
      sessionId: null,
      startTime: 4,
    });
    expect(c).not.toBe(d);
  });
});

describe("createLongTimerReminder", () => {
  it("viser påmindelsen én gang pr. timer", () => {
    const { update, show } = setup();
    update({ isRunning: true, elapsedSeconds: 60, key: "k1" });
    expect(show).not.toHaveBeenCalled();
    update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    update({ isRunning: true, elapsedSeconds: LONG + 1, key: "k1" });
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(
      expect.stringMatching(/^k1#/),
      10,
      expect.any(Function),
    );
  });

  it("lukker påmindelsen, når timeren stoppes ad anden vej", () => {
    const { reminder, update, dismiss, toastOf } = setup();
    update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    expect(reminder.canStop(toastOf("k1"))).toBe(true);
    update({ isRunning: false, elapsedSeconds: LONG, key: "k1" });
    expect(dismiss).toHaveBeenCalledWith(toastOf("k1"));
    expect(reminder.canStop(toastOf("k1"))).toBe(false);
  });

  it("lader en gammel påmindelse ikke stoppe en ny timer", () => {
    const { reminder, update, dismiss, toastOf } = setup();
    update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    update({ isRunning: true, elapsedSeconds: 3, key: "k2" });
    expect(dismiss).toHaveBeenCalledWith(toastOf("k1"));
    expect(reminder.canStop(toastOf("k1"))).toBe(false);
  });

  it("minder om en ny løbsk timer efter den første", () => {
    const { reminder, update, show, toastOf } = setup();
    update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    update({ isRunning: false, elapsedSeconds: 0, key: "k1" });
    update({ isRunning: true, elapsedSeconds: LONG, key: "k2" });
    expect(show).toHaveBeenCalledTimes(2);
    expect(reminder.canStop(toastOf("k2"))).toBe(true);
  });

  it("viser den ikke igen efter genindlæsning (sessionStorage)", () => {
    const first = setup();
    first.update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    const show = vi.fn();
    const again = createLongTimerReminder({
      show,
      dismiss: vi.fn(),
      storage: () => ({
        getItem: (k) => first.store.get(k) ?? null,
        setItem: () => {},
      }),
      confirmation: fixedConfirmation(LONG),
    });
    again.update({ isRunning: true, sessionId: null, key: "k1" });
    expect(show).not.toHaveBeenCalled();
  });

  it("viser den stadig, når sessionStorage kaster", () => {
    const show = vi.fn();
    const reminder = createLongTimerReminder({
      show,
      dismiss: vi.fn(),
      storage: () => {
        throw new Error("SecurityError");
      },
      confirmation: fixedConfirmation(LONG),
    });
    reminder.update({ isRunning: true, sessionId: null, key: "k1" });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("glemmer en påmindelse, brugeren selv har lukket", () => {
    const { reminder, update, show, dismiss, toastOf } = setup();
    update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    const closedByUser = show.mock.calls[0][2];
    closedByUser();
    expect(reminder.canStop(toastOf("k1"))).toBe(false);
    update({ isRunning: false, elapsedSeconds: 0, key: "k1" });
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("viser påmindelsen igen, selv om Sonner melder fanens egen skjulning som lukket", () => {
    const { reminder, update, show, toastOf } = setup();
    update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    const firstClosed = show.mock.calls[0][2];

    // Fokus skjuler påmindelsen; Sonner kalder onDismiss bagefter.
    update({ isRunning: true, elapsedSeconds: null, key: "k1" });
    firstClosed();

    update({ isRunning: true, elapsedSeconds: LONG + 60, key: "k1" });
    expect(show).toHaveBeenCalledTimes(2);
    expect(reminder.canStop(toastOf("k1"))).toBe(true);

    // En sen onDismiss fra den skjulte visning rører ikke den nye.
    firstClosed();
    expect(reminder.canStop(toastOf("k1"))).toBe(true);
  });

  it("skjuler en vist påmindelse, til serveren har bekræftet igen (#1324)", () => {
    const { reminder, update, show, dismiss, toastOf } = setup();
    update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    expect(show).toHaveBeenCalledTimes(1);

    // Fokus: bekræftelsen er glemt. Påmindelsen og dens stop-knap forsvinder.
    update({ isRunning: true, elapsedSeconds: null, key: "k1" });
    expect(dismiss).toHaveBeenCalledWith(toastOf("k1"));
    expect(reminder.canStop(toastOf("k1"))).toBe(false);

    // Serveren bekræfter samme timer igen: påmindelsen kommer tilbage.
    update({ isRunning: true, elapsedSeconds: LONG + 60, key: "k1" });
    expect(show).toHaveBeenCalledTimes(2);
    expect(reminder.canStop(toastOf("k1"))).toBe(true);
    // Nyt toast-id: Sonner fjerner ellers den nye visning sammen med den
    // gamle, der stadig er under lukning.
    expect(show.mock.calls[1][0]).not.toBe(show.mock.calls[0][0]);
  });

  it("viser ikke en skjult påmindelse igen, når serveren kører en anden timer", () => {
    const { reminder, update, show, toastOf } = setup();
    update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    update({ isRunning: true, elapsedSeconds: null, key: "k1" });
    // Afstemningen adopterer en frisk timer fra udvidelsen.
    update({ isRunning: true, elapsedSeconds: 180, key: "k2" });
    expect(show).toHaveBeenCalledTimes(1);
    expect(reminder.canStop(toastOf("k1"))).toBe(false);
    expect(reminder.canStop(toastOf("k2"))).toBe(false);
  });
});
