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

  it("prøver ikke en GET igen, når vores egen timeout udløber", async () => {
    // Uden genforsøg kan én GET højst tage én timeout (20 s), ikke 3 x 20 s.
    const timeout = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
    fetchMock.mockImplementation(async () => {
      timeout.abort(
        new DOMException("The operation timed out.", "TimeoutError"),
      );
      throw timeout.signal.reason;
    });
    const err = await alunta.subscriptions.get("sub-uuid").catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.name).toBe("TimeoutError");
    expect(isAluntaUpstreamError(err)).toBe(true);
  });

  it("regner 429 efter genforsøg som upstream-fejl", async () => {
    fetchMock.mockImplementation(async () =>
      json({ message: "Too Many Attempts." }, 429),
    );
    const err = await alunta.subscriptions.listAll().catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(err.status).toBe(429);
    expect(isAluntaUpstreamError(err)).toBe(true);
  });

  it("regner en vedvarende netværksfejl som upstream-fejl", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await alunta.subscriptions.listAll().catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(isAluntaUpstreamError(err)).toBe(true);
  });

  it("regner et brud under læsning af svaret som upstream-fejl", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":'));
        controller.error(new TypeError("terminated"));
      },
    });
    fetchMock.mockImplementation(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const err = await alunta.subscriptions.get("sub-uuid").catch((e) => e);
    expect(err.message).toBe("terminated");
    expect(isAluntaUpstreamError(err)).toBe(true);
  });

  it("regner ugyldig JSON fra Alunta som ikke-upstream", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response("{ikke json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const err = await alunta.subscriptions.get("sub-uuid").catch((e) => e);
    expect(err).toBeInstanceOf(SyntaxError);
    expect(isAluntaUpstreamError(err)).toBe(false);
  });

  it("regner andre fejl (fx en kodefejl) som ikke-upstream", () => {
    expect(isAluntaUpstreamError(new TypeError("x is undefined"))).toBe(false);
    expect(isAluntaUpstreamError("Alunta API 500")).toBe(false);
  });
});
