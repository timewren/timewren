import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Valkey-cachen som et simpelt Map, så testen kan se hvad der gemmes og hvor længe.
const store = new Map<string, { value: string; ttl: number }>();
vi.mock("@/lib/valkey", () => {
  const m = {
    getValkey: () => ({
      get: async (key: string) => store.get(key)?.value ?? null,
      set: async (key: string, value: string, _ex: string, ttl: number) => {
        store.set(key, { value, ttl });
        return "OK";
      },
    }),
  };
  return { ...m, getReadyValkey: m.getValkey };
});

import { CvrLookupError, lookupCVR, searchCVR } from "../cvr";

const company = {
  vat: 12345678,
  name: "Testfirma ApS",
  address: "Vej 1",
  city: "Byen",
  zipcode: "1234",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("CVR-opslag", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    store.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("gemmer et svar i 24 timer, så samme opslag ikke rammer cvrapi.dk igen", async () => {
    fetchMock.mockResolvedValue(jsonResponse(company));

    const first = await lookupCVR("12 34 56 78");
    const second = await lookupCVR("12345678");

    expect(first?.name).toBe("Testfirma ApS");
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.get("cache:cvr:lookup:12345678")?.ttl).toBe(86_400);
  });

  it("cacher også fritekstsøgninger i 24 timer", async () => {
    fetchMock.mockResolvedValue(jsonResponse(company));

    await searchCVR("Testfirma");
    await searchCVR("testfirma");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.get("cache:cvr:search:testfirma")?.ttl).toBe(86_400);
  });

  it("melder rate-limit som en forventet fejl med dansk tekst", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "QUOTA_EXCEEDED" }, 402));

    const error = await searchCVR("Testfirma").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CvrLookupError);
    expect((error as CvrLookupError).kind).toBe("rate_limited");
    expect((error as Error).message).toMatch(/prøv igen/i);
    expect((error as Error).message).not.toMatch(/QUOTA/);
  });

  it("viser aldrig cvrapi.dk's rå fejlkode som besked", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "QUOTA_EXCEEDED" }));

    const error = await lookupCVR("12345678").catch((e: unknown) => e);

    expect((error as CvrLookupError).kind).toBe("rate_limited");
    expect((error as Error).message).not.toMatch(/QUOTA/);
  });

  it("melder timeout, når cvrapi.dk ikke svarer", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.useFakeTimers();
    try {
      const pending = lookupCVR("12345678").catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(30_000);
      const error = await pending;
      expect((error as CvrLookupError).kind).toBe("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("melder netværksfejl og 5xx som 'utilgængelig'", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const network = await searchCVR("Testfirma").catch((e: unknown) => e);
    expect((network as CvrLookupError).kind).toBe("unavailable");

    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    const server = await lookupCVR("12345678").catch((e: unknown) => e);
    expect((server as CvrLookupError).kind).toBe("unavailable");
  });

  it("returnerer null for en søgning uden fund og fejler et ukendt CVR-nummer", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "NOT_FOUND" }, 404));

    expect(await searchCVR("Findes ikke")).toBeNull();
    const error = await lookupCVR("87654321").catch((e: unknown) => e);
    expect((error as CvrLookupError).kind).toBe("not_found");
  });
});
