import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setAluntaRetryDelaysForTests,
  alunta,
  isAluntaUpstreamError,
} from "./alunta";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const page = { data: [], meta: { last_page: 1 } };

describe("aluntaFetch genforsøg", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    __setAluntaRetryDelaysForTests([0, 0]);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __setAluntaRetryDelaysForTests([1_000, 3_000]);
  });

  it("prøver en GET igen efter en enkelt 500 fra Alunta (fejlspor 53)", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ message: "Server Error" }, 500))
      .mockResolvedValueOnce(json(page));
    await expect(alunta.subscriptions.listAll()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("prøver igen efter en netværksfejl", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json(page));
    await expect(alunta.subscriptions.listAll()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("giver op efter to genforsøg med en upstream-fejl", async () => {
    fetchMock.mockImplementation(async () =>
      json({ message: "Server Error" }, 502),
    );
    const err = await alunta.subscriptions.listAll().catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(isAluntaUpstreamError(err)).toBe(true);
    expect(err.message).toMatch(/^Alunta API 502/);
  });

  it("prøver ikke en 4xx igen", async () => {
    fetchMock.mockResolvedValue(json({ message: "Unauthenticated" }, 401));
    const err = await alunta.subscriptions.listAll().catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isAluntaUpstreamError(err)).toBe(false);
    expect(err.status).toBe(401);
  });

  it("prøver aldrig en skrivning igen", async () => {
    fetchMock.mockResolvedValue(json({ message: "Server Error" }, 500));
    const err = await alunta.subscriptions
      .updateQuantity("sub-uuid", 3)
      .catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isAluntaUpstreamError(err)).toBe(true);
  });
});
