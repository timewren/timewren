import { describe, expect, it } from "vitest";
import { MAX_POLL_BACKOFF_MS, pollBackoffMs } from "../backoff";

describe("pollBackoffMs (timer-polling giver aldrig op)", () => {
  it("ingen ventetid før fejlgrænsen", () => {
    expect(pollBackoffMs(0)).toBe(0);
    expect(pollBackoffMs(4)).toBe(0);
  });

  it("eksponentiel backoff fra 5 fejl i træk", () => {
    expect(pollBackoffMs(5)).toBe(15_000);
    expect(pollBackoffMs(6)).toBe(30_000);
    expect(pollBackoffMs(7)).toBe(60_000);
  });

  it("loftet er 5 min — også efter rigtig mange fejl", () => {
    expect(MAX_POLL_BACKOFF_MS).toBe(300_000);
    expect(pollBackoffMs(12)).toBe(300_000);
    expect(pollBackoffMs(1000)).toBe(300_000);
  });
});
