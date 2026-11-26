import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.fn();
vi.mock("@/lib/utils/sentry", () => ({
  captureServerMessage: (...args: unknown[]) => captureMessage(...args),
}));

import {
  __resetValkeyAlertForTests,
  reportValkeyError,
  reportValkeyReady,
  VALKEY_ALERT_GRACE_MS,
} from "@/lib/valkey";

const T0 = 1_000_000;

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

  it("does not alert on a short blip that recovers within the grace period", () => {
    reportValkeyError("getaddrinfo ENOTFOUND valkey", T0);
    reportValkeyError("getaddrinfo ENOTFOUND valkey", T0 + 2_000);
    reportValkeyReady();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("alerts once when the outage outlasts the grace period", () => {
    reportValkeyError("ECONNREFUSED", T0);
    reportValkeyError("ECONNREFUSED", T0 + VALKEY_ALERT_GRACE_MS - 1);
    expect(captureMessage).not.toHaveBeenCalled();

    reportValkeyError("ECONNREFUSED", T0 + VALKEY_ALERT_GRACE_MS);
    reportValkeyError("ECONNREFUSED", T0 + VALKEY_ALERT_GRACE_MS + 2_000);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("Valkey connection lost"),
      { level: "warning" },
    );
  });

  it("alerts on recovery and re-arms for the next outage", () => {
    reportValkeyError("down", T0);
    reportValkeyError("down", T0 + VALKEY_ALERT_GRACE_MS);
    expect(captureMessage).toHaveBeenCalledTimes(1);

    reportValkeyReady();
    expect(captureMessage).toHaveBeenCalledTimes(2);
    expect(captureMessage).toHaveBeenLastCalledWith(
      "Valkey connection restored",
      { level: "info" },
    );

    // Re-armed: a fresh outage starts a new grace period, then alerts again.
    const T1 = T0 + 10 * VALKEY_ALERT_GRACE_MS;
    reportValkeyError("down again", T1);
    expect(captureMessage).toHaveBeenCalledTimes(2);
    reportValkeyError("down again", T1 + VALKEY_ALERT_GRACE_MS);
    expect(captureMessage).toHaveBeenCalledTimes(3);
  });

  it("does not alert on ready when it was never down", () => {
    reportValkeyReady();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
