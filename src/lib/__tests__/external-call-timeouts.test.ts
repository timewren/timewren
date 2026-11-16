import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** fetch der aldrig svarer, men afbrydes af signalet, som i en rigtig runtime. */
function hangingFetch() {
  return vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason ?? new Error("aborted")),
        );
      }),
  );
}

vi.mock("@/lib/db", () => ({ db: {} }));

describe("external calls give up on a hanging server", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("sendExpoPush does not hang when Expo does not answer", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { sendExpoPush } = await import("@/lib/notifications/expo-push");
    const done = sendExpoPush(["ExponentPushToken[abc123]"], {
      title: "t",
      body: "b",
    });
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(done).resolves.toMatchObject({ attempted: 1, sent: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Alunta calls are aborted after the timeout", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "test-key");
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { alunta } = await import("@/lib/alunta");
    const done = alunta.checkoutSessions
      .create({ plan_id: "p", external_customer_id: "c" })
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await done).toBeInstanceOf(Error);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("Dokploy domain registration returns a failure instead of hanging", async () => {
    vi.stubEnv("DOKPLOY_API_URL", "https://dokploy.example.com");
    vi.stubEnv("DOKPLOY_API_TOKEN", "t");
    vi.stubEnv("DOKPLOY_APP_ID", "app");
    vi.stubGlobal("fetch", hangingFetch());
    const { registerDomainWithDokploy } = await import("@/lib/hosting/dokploy");
    const done = registerDomainWithDokploy("kunde.example.com");
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(done).resolves.toMatchObject({ success: false });
  });

  it("Resend mail sending fails normally instead of hanging", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("MAIL_TRANSPORT", "");
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { resend } = await import("@/lib/resend");
    const done = resend.emails.send({
      from: "Testkunde ApS <noreply@example.com>",
      to: "anna@example.com",
      subject: "Hej",
      text: "Hej",
    });
    await vi.advanceTimersByTimeAsync(16_000);
    const result = await done;
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[Mail]"),
      expect.anything(),
    );
  });

  it("Resend sending still times out when the caller passes its own signal", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("MAIL_TRANSPORT", "");
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { resend } = await import("@/lib/resend");
    const caller = new AbortController();
    const done = resend.emails.send(
      {
        from: "Testkunde ApS <noreply@example.com>",
        to: "anna@example.com",
        subject: "Hej",
        text: "Hej",
      },
      { signal: caller.signal },
    );
    await vi.advanceTimersByTimeAsync(16_000);
    const result = await done;
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(caller.signal.aborted).toBe(false);
  });
});
