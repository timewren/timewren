import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.fn();
vi.mock("@/lib/utils/sentry", () => ({
  captureServerMessage: (...args: unknown[]) => captureMessage(...args),
}));

import {
  __resetValkeyAlertForTests,
  reportValkeyError,
  reportValkeyReady,
} from "@/lib/valkey";

describe("Valkey Sentry alert throttle", () => {
  beforeEach(() => {
    captureMessage.mockClear();
    __resetValkeyAlertForTests();
    // Silence the [valkey] console.error so test output stays pristine.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("alerts Sentry once per down-episode despite repeated errors", () => {
    reportValkeyError("ECONNREFUSED");
    reportValkeyError("ECONNREFUSED");
    reportValkeyError("ECONNREFUSED");
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("Valkey connection lost"),
      { level: "warning" },
    );
  });

  it("alerts on recovery and re-arms for the next outage", () => {
    reportValkeyError("down");
    expect(captureMessage).toHaveBeenCalledTimes(1);

    reportValkeyReady();
    expect(captureMessage).toHaveBeenCalledTimes(2);
    expect(captureMessage).toHaveBeenLastCalledWith(
      "Valkey connection restored",
      { level: "info" },
    );

    // Re-armed: a fresh outage alerts again.
    reportValkeyError("down again");
    expect(captureMessage).toHaveBeenCalledTimes(3);
  });

  it("does not alert on ready when it was never down", () => {
    reportValkeyReady();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
