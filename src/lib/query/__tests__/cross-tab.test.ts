import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetDataChannelForTests,
  broadcastDataChange,
  DATA_CHANNEL_NAME,
  parseDataChangeMessage,
  subscribeDataChanges,
} from "../cross-tab";

afterEach(() => {
  __resetDataChannelForTests();
  vi.unstubAllGlobals();
});

describe("parseDataChangeMessage", () => {
  it("accepterer domænelister og 'all'", () => {
    expect(
      parseDataChangeMessage({ type: "data_changed", domains: ["time"] }),
    ).toEqual({ type: "data_changed", domains: ["time"] });
    expect(
      parseDataChangeMessage({ type: "data_changed", domains: "all" }),
    ).toEqual({ type: "data_changed", domains: "all" });
  });

  it("bevarer afsenderfanen fra SSE-events", () => {
    expect(
      parseDataChangeMessage({
        type: "data_changed",
        domains: ["time"],
        origin: "tab-1",
      }),
    ).toEqual({ type: "data_changed", domains: ["time"], origin: "tab-1" });
  });

  it("ignorerer ukendte beskeder", () => {
    expect(parseDataChangeMessage(null)).toBeNull();
    expect(parseDataChangeMessage({ type: "sync" })).toBeNull();
    expect(
      parseDataChangeMessage({ type: "data_changed", domains: [1] }),
    ).toBeNull();
  });
});

describe("broadcastDataChange / subscribeDataChanges", () => {
  it("en anden fane modtager ændringen", async () => {
    // "Den anden fane": en separat kanal med samme navn.
    const other = new BroadcastChannel(DATA_CHANNEL_NAME);
    const received = new Promise<unknown>((resolve) => {
      other.onmessage = (e) => resolve(e.data);
    });
    broadcastDataChange(["time", "prepaid"]);
    await expect(received).resolves.toEqual({
      type: "data_changed",
      domains: ["time", "prepaid"],
    });
    other.close();
  });

  it("modtager beskeder fra andre faner", async () => {
    const handler = vi.fn();
    const unsubscribe = subscribeDataChanges(handler);
    const other = new BroadcastChannel(DATA_CHANNEL_NAME);
    other.postMessage({ type: "data_changed", domains: "all" });
    await vi.waitFor(() =>
      expect(handler).toHaveBeenCalledWith({
        type: "data_changed",
        domains: "all",
      }),
    );
    unsubscribe();
    other.close();
  });

  it("er en tavs no-op uden BroadcastChannel", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    expect(() => broadcastDataChange(["time"])).not.toThrow();
    const unsubscribe = subscribeDataChanges(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
