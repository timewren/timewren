import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BaseIntegration,
  fetchWithTimeout,
  INTEGRATION_REQUEST_TIMEOUT_MS,
  IntegrationAuthError,
} from "@/lib/integrations/base";

class TestIntegration extends BaseIntegration {
  protected integrationName = "Test";

  testConnection(): Promise<boolean> {
    return Promise.resolve(true);
  }

  request(): Promise<string> {
    return this.fetchWithRetry(
      "https://example.test/protected",
      { headers: {} },
      async () => "ok",
    );
  }
}

describe("BaseIntegration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves auth errors so tRPC can turn them into user-facing errors", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("Unauthorized", {
          status: 401,
          statusText: "Unauthorized",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(new TestIntegration().request()).rejects.toMatchObject({
      name: "IntegrationAuthError",
      statusCode: 401,
    });
    await expect(new TestIntegration().request()).rejects.toBeInstanceOf(
      IntegrationAuthError,
    );
  });
});

describe("forbindelsestest mod regnskabssystemer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function hangingFetch() {
    return vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
  }

  it("giver op efter en timeout i stedet for at hænge, når API'et ikke svarer", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", hangingFetch());
    const { BillyIntegration } = await import("@/lib/integrations/billy");
    const { DineroIntegration } = await import("@/lib/integrations/dinero");
    const { EconomicIntegration } = await import("@/lib/integrations/economic");

    const results = Promise.all([
      new BillyIntegration("key").testConnection(),
      new DineroIntegration("key", "org").testConnection(),
      new EconomicIntegration("secret", "grant").testConnection(),
    ]);
    await vi.advanceTimersByTimeAsync(INTEGRATION_REQUEST_TIMEOUT_MS);

    expect(await results).toEqual([false, false, false]);
  });

  it("fetchWithTimeout afbryder kaldet efter fristen", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());

    const pending = fetchWithTimeout("https://example.test", {}, 1_000).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(1_000);

    expect(((await pending) as Error).name).toBe("AbortError");
  });
});
