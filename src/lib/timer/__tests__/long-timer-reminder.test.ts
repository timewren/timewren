import { describe, expect, it, vi } from "vitest";
import {
  createLongTimerReminder,
  LONG_TIMER_SECONDS,
  longTimerKey,
} from "../long-timer-reminder";

function setup() {
  const store = new Map<string, string>();
  const show = vi.fn();
  const dismiss = vi.fn();
  const reminder = createLongTimerReminder({
    show,
    dismiss,
    storage: () => ({
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => {
        store.set(k, v);
      },
    }),
  });
  return { reminder, show, dismiss, store };
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
    const { reminder, show } = setup();
    reminder.update({ isRunning: true, elapsedSeconds: 60, key: "k1" });
    expect(show).not.toHaveBeenCalled();
    reminder.update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    reminder.update({ isRunning: true, elapsedSeconds: LONG + 1, key: "k1" });
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith("k1", 10);
  });

  it("lukker påmindelsen, når timeren stoppes ad anden vej", () => {
    const { reminder, dismiss } = setup();
    reminder.update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    expect(reminder.canStop("k1")).toBe(true);
    reminder.update({ isRunning: false, elapsedSeconds: LONG, key: "k1" });
    expect(dismiss).toHaveBeenCalledWith("k1");
    expect(reminder.canStop("k1")).toBe(false);
  });

  it("lader en gammel påmindelse ikke stoppe en ny timer", () => {
    const { reminder, dismiss } = setup();
    reminder.update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    reminder.update({ isRunning: true, elapsedSeconds: 3, key: "k2" });
    expect(dismiss).toHaveBeenCalledWith("k1");
    expect(reminder.canStop("k1")).toBe(false);
  });

  it("minder om en ny løbsk timer efter den første", () => {
    const { reminder, show } = setup();
    reminder.update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    reminder.update({ isRunning: false, elapsedSeconds: 0, key: "k1" });
    reminder.update({ isRunning: true, elapsedSeconds: LONG, key: "k2" });
    expect(show).toHaveBeenCalledTimes(2);
    expect(reminder.canStop("k2")).toBe(true);
  });

  it("viser den ikke igen efter genindlæsning (sessionStorage)", () => {
    const first = setup();
    first.reminder.update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    const show = vi.fn();
    const again = createLongTimerReminder({
      show,
      dismiss: vi.fn(),
      storage: () => ({
        getItem: (k) => first.store.get(k) ?? null,
        setItem: () => {},
      }),
    });
    again.update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
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
    });
    reminder.update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("glemmer en påmindelse, brugeren selv har lukket", () => {
    const { reminder, dismiss } = setup();
    reminder.update({ isRunning: true, elapsedSeconds: LONG, key: "k1" });
    reminder.dismissed("k1");
    reminder.update({ isRunning: false, elapsedSeconds: 0, key: "k1" });
    expect(dismiss).not.toHaveBeenCalled();
  });
});
