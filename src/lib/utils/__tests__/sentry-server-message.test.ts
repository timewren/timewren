import { beforeEach, describe, expect, it, vi } from "vitest";

const captureEvent = vi.fn();
const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureEvent: (...args: unknown[]) => captureEvent(...args),
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

import { captureServerMessage } from "@/lib/utils/sentry";

describe("captureServerMessage", () => {
  beforeEach(() => {
    captureEvent.mockClear();
    captureMessage.mockClear();
  });

  it("sends the text as the event message without a synthetic stacktrace", () => {
    captureServerMessage("[stabilitet] hours_mismatch: Timer passer ikke", {
      level: "warning",
      tags: { detector: "hours_mismatch" },
      fingerprint: ["stability", "x"],
    });
    expect(captureMessage).not.toHaveBeenCalled();
    expect(captureEvent).toHaveBeenCalledTimes(1);
    const event = captureEvent.mock.calls[0][0];
    expect(event).toMatchObject({
      message: "[stabilitet] hours_mismatch: Timer passer ikke",
      level: "warning",
      tags: { detector: "hours_mismatch" },
      fingerprint: ["stability", "x"],
    });
    expect(event.exception).toBeUndefined();
  });

  it("defaults to info level", () => {
    captureServerMessage("Valkey connection restored");
    expect(captureEvent.mock.calls[0][0].level).toBe("info");
  });
});
