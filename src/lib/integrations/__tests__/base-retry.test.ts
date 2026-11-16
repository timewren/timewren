import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseIntegration } from "../base";

class TestIntegration extends BaseIntegration {
  protected integrationName = "Test";
  constructor() {
    super({ baseDelay: 1, maxDelay: 2 });
  }
  testConnection() {
    return Promise.resolve(true);
  }
  call(options: RequestInit) {
    return this.fetchWithRetry("https://api.example.com/x", options, (r) =>
      r.json(),
    );
  }
}

const json = (status: number) =>
  new Response(JSON.stringify({ ok: status < 400 }), { status });

describe("BaseIntegration.fetchWithRetry", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries a GET after a 503", async () => {
    fetchMock.mockResolvedValueOnce(json(503)).mockResolvedValueOnce(json(200));
    await expect(new TestIntegration().call({})).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a POST after a 503 (could create duplicates)", async () => {
    fetchMock.mockResolvedValue(json(503));
    await expect(
      new TestIntegration().call({ method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a POST after a network error", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    await expect(
      new TestIntegration().call({ method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a POST after 429, since the call was not processed", async () => {
    fetchMock.mockResolvedValueOnce(json(429)).mockResolvedValueOnce(json(200));
    await expect(
      new TestIntegration().call({ method: "POST", body: "{}" }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
