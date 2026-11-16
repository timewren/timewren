import { afterEach, describe, expect, it, vi } from "vitest";
import { onFeedbackSignOut, prepareFeedbackForSignOut } from "../sign-out";

describe("prepareFeedbackForSignOut", () => {
  let off: (() => void) | undefined;
  afterEach(() => {
    off?.();
    vi.useRealTimers();
  });

  it("gør intet, når panelet ikke er monteret", async () => {
    await expect(prepareFeedbackForSignOut()).resolves.toBeUndefined();
  });

  it("venter på panelets oprydning før log ud", async () => {
    const order: string[] = [];
    off = onFeedbackSignOut(async () => {
      order.push("ryddet");
    });
    await prepareFeedbackForSignOut();
    order.push("log ud");
    expect(order).toEqual(["ryddet", "log ud"]);
  });

  it("venter højst timeoutMs og kaster aldrig", async () => {
    vi.useFakeTimers();
    off = onFeedbackSignOut(() => new Promise(() => {}));
    const done = prepareFeedbackForSignOut(1500);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(done).resolves.toBeUndefined();

    off();
    off = onFeedbackSignOut(() => Promise.reject(new Error("IDB væk")));
    await expect(prepareFeedbackForSignOut()).resolves.toBeUndefined();
  });

  it("en afmeldt oprydning kaldes ikke", async () => {
    const fn = vi.fn(async () => {});
    onFeedbackSignOut(fn)();
    await prepareFeedbackForSignOut();
    expect(fn).not.toHaveBeenCalled();
  });
});
