import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const publish = vi.fn().mockResolvedValue(1);
vi.mock("@/lib/valkey", () => {
  const m = { getValkey: () => ({ publish }) };
  return { ...m, getReadyValkey: m.getValkey };
});

import {
  orgChannel,
  publishDataChanged,
  sseEventName,
  userChannel,
} from "@/lib/realtime";

describe("publishDataChanged", () => {
  beforeEach(() => {
    publish.mockClear();
    vi.stubEnv("REALTIME_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sender alle domæner til brugeren og kun de delte til org'en", async () => {
    await publishDataChanged("u1", "o1", ["time", "prepaid", "dashboard"]);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0][0]).toBe(userChannel("u1"));
    expect(JSON.parse(publish.mock.calls[0][1])).toEqual({
      type: "data_changed",
      userId: "u1",
      domains: ["time", "prepaid", "dashboard"],
    });
    expect(publish.mock.calls[1][0]).toBe(orgChannel("o1"));
    expect(JSON.parse(publish.mock.calls[1][1]).domains).toEqual(["prepaid"]);
  });

  it("tager afsenderfanen med, så den kan ignorere sit ekko", async () => {
    await publishDataChanged("u1", null, ["time"], "tab-1");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(JSON.parse(publish.mock.calls[0][1]).origin).toBe("tab-1");
  });

  it("springer org-kanalen over når intet er org-delt", async () => {
    await publishDataChanged("u1", "o1", ["time", "dashboard"]);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("er en no-op når realtime er slået fra", async () => {
    vi.stubEnv("REALTIME_ENABLED", "false");
    await publishDataChanged("u1", "o1", ["time"]);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("sseEventName", () => {
  it("sender data-events som 'data', så ældre klienter ignorerer dem", () => {
    const msg = JSON.stringify({
      type: "data_changed",
      userId: "u1",
      domains: ["time"],
    });
    expect(sseEventName(userChannel("u1"), msg)).toBe("data");
    expect(sseEventName(orgChannel("o1"), msg)).toBe("data");
  });

  it("beholder timer/team for timer-events", () => {
    const msg = JSON.stringify({ type: "sync", userId: "u1" });
    expect(sseEventName(userChannel("u1"), msg)).toBe("timer");
    expect(sseEventName(orgChannel("o1"), msg)).toBe("team");
    expect(sseEventName(userChannel("u1"), "not json")).toBe("timer");
  });
});
