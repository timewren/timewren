import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, unknown>();
const action = {
  setBadgeText: vi.fn(async () => {}),
  setBadgeBackgroundColor: vi.fn(async () => {}),
  setBadgeTextColor: vi.fn(async () => {}),
  setIcon: vi.fn(async () => {}),
  setTitle: vi.fn(async () => {}),
};
vi.stubGlobal("chrome", {
  action,
  storage: {
    local: {
      get: async (keys: string[]) =>
        Object.fromEntries(
          keys.filter((k) => storage.has(k)).map((k) => [k, storage.get(k)]),
        ),
    },
  },
});

async function freshManager() {
  vi.resetModules();
  return (await import("./badgeManager")).badgeManager;
}

beforeEach(() => {
  storage.clear();
  for (const fn of Object.values(action)) fn.mockClear();
});

describe("badget (#C12)", () => {
  it("læser indstillingen før første visning", async () => {
    storage.set("extensionSettings", { badgeDisplay: "off" });
    const badge = await freshManager();
    await badge.update("timer", {
      isRunning: true,
      startTime: new Date().toISOString(),
      baseSeconds: 600,
    });
    const texts = action.setBadgeText.mock.calls.map(
      (c) => (c as unknown as [{ text: string }])[0].text,
    );
    expect(texts).toEqual([""]);
  });

  it("springer identiske kald over", async () => {
    const badge = await freshManager();
    const timer = { isRunning: false, startTime: null, baseSeconds: 0 };
    await badge.update("timer", { ...timer, todayHours: 2 });
    await badge.update("timer", { ...timer, todayHours: 2 });
    expect(action.setBadgeText).toHaveBeenCalledTimes(1);
    expect(action.setBadgeBackgroundColor).toHaveBeenCalledTimes(1);
  });

  it("henter kun dagens timer, når badget viser dem", async () => {
    const badge = await freshManager();
    expect(
      await badge.showsTodayHours({ isRunning: true, baseSeconds: 0 }),
    ).toBe(false);
    expect(
      await badge.showsTodayHours({ isRunning: false, baseSeconds: 60 }),
    ).toBe(false);
    expect(
      await badge.showsTodayHours({ isRunning: false, baseSeconds: 0 }),
    ).toBe(true);
    storage.set("extensionSettings", { badgeDisplay: "today" });
    await badge.loadSettings();
    expect(
      await badge.showsTodayHours({ isRunning: true, baseSeconds: 0 }),
    ).toBe(true);
  });
});
