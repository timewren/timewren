import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Valkey-cachen er tom i hver test, så fallback-stien altid kalder cvrapi.dk.
vi.mock("@/lib/valkey", () => {
  const m = {
    getValkey: () => ({ get: async () => null, set: async () => "OK" }),
  };
  return { ...m, getReadyValkey: m.getValkey };
});

import { lookupCVR, searchCVR, searchCVRMany } from "../cvr";

const mahope = {
  cvr: "39413892",
  navn: "Mahope",
  adresse: {
    vej: "Testvej",
    husnummer: "1",
    etage: "2",
    sidedoer: "tv",
    postnr: "8000",
    by: "Aarhus C",
  },
  branche: { kode: "620100", tekst: "Computerprogrammering" },
  status: "NORMAL",
  aktiv: true,
  stiftet: "2018-04-01",
  kontakt: { email: "info@example.dk", telefon: "12345678" },
};

const cvrapi = {
  vat: 39413892,
  name: "Mahope (cvrapi)",
  address: "Testvej 1",
  city: "Aarhus C",
  zipcode: "8000",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CVR_SERVICE_API_KEY", "test-noegle");
  vi.stubEnv("CVR_SERVICE_URL", "https://cvr.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const calledUrl = (n = 0) => String(fetchMock.mock.calls[n]?.[0]);

describe("CVR via Mahopes CVR-tjeneste", () => {
  it("slår et CVR-nummer op i tjenesten med nøglen og mapper felterne", async () => {
    fetchMock.mockResolvedValueOnce(json(mahope));
    const r = await lookupCVR("39 41 38 92");
    expect(calledUrl()).toBe("https://cvr.test/v1/virksomhed/39413892");
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe("Bearer test-noegle");
    expect(r).toMatchObject({
      cvrNumber: "39413892",
      name: "Mahope",
      address: "Testvej 1, 2 tv",
      city: "Aarhus C",
      postalCode: "8000",
      industry: "620100",
      status: "Aktiv",
      phoneNumber: "12345678",
      startDate: "2018-04-01",
    });
  });

  it("404 fra tjenesten betyder ikke fundet, uden fallback", async () => {
    fetchMock.mockResolvedValueOnce(json({ fejl: "Ikke fundet" }, 404));
    await expect(lookupCVR("12345678")).rejects.toThrow(
      "Ingen virksomhed fundet",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falder tilbage til cvrapi.dk, når tjenesten fejler", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ fejl: "Intern fejl" }, 500))
      .mockResolvedValueOnce(json(cvrapi));
    const r = await lookupCVR("39413892");
    expect(calledUrl(1)).toContain("cvrapi.dk/api?vat=39413892");
    expect(r?.name).toBe("Mahope (cvrapi)");
  });

  it("bruger cvrapi.dk, når nøglen ikke er sat", async () => {
    vi.stubEnv("CVR_SERVICE_API_KEY", "");
    fetchMock.mockResolvedValueOnce(json(cvrapi));
    await lookupCVR("39413892");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledUrl()).toContain("cvrapi.dk");
  });

  it("navnesøgning bruger tjenestens søgning og returnerer det bedste træf", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ resultater: [{ virksomhed: { ...mahope, aktiv: false } }] }),
    );
    const r = await searchCVR("mahope");
    expect(calledUrl()).toBe("https://cvr.test/v1/soeg?q=mahope&limit=1");
    expect(r).toMatchObject({ name: "Mahope", status: "Ophørt" });
  });

  it("navnesøgning uden træf giver null", async () => {
    fetchMock.mockResolvedValueOnce(json({ resultater: [] }));
    expect(await searchCVR("findes ikke")).toBeNull();
  });

  it("telefonsøgning går stadig til cvrapi.dk", async () => {
    fetchMock.mockResolvedValueOnce(json(cvrapi));
    await searchCVR("12 34 56 78 90");
    expect(calledUrl()).toContain("cvrapi.dk/api?phone=");
  });
});

describe("searchCVRMany (navneforslag)", () => {
  it("returnerer flere mappede forslag fra tjenesten, kun aktive", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        resultater: [
          { virksomhed: mahope },
          {
            virksomhed: { ...mahope, cvr: "11111111", navn: "Mahope Hosting" },
          },
        ],
      }),
    );
    const r = await searchCVRMany("mahope", 5);
    expect(calledUrl()).toBe(
      "https://cvr.test/v1/soeg?q=mahope&limit=5&aktiv=true",
    );
    expect(r.map((c) => [c.cvrNumber, c.name])).toEqual([
      ["39413892", "Mahope"],
      ["11111111", "Mahope Hosting"],
    ]);
    expect(r[0]).toMatchObject({
      address: "Testvej 1, 2 tv",
      postalCode: "8000",
    });
  });

  it("giver tom liste uden træf og for tom søgetekst", async () => {
    fetchMock.mockResolvedValueOnce(json({ resultater: [] }));
    expect(await searchCVRMany("findes ikke")).toEqual([]);
    expect(await searchCVRMany("   ")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falder tilbage til cvrapi.dk (ét træf), når tjenesten fejler", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ fejl: "x" }, 503))
      .mockResolvedValueOnce(json(cvrapi));
    const r = await searchCVRMany("mahope");
    expect(calledUrl(1)).toContain("cvrapi.dk/api?search=mahope");
    expect(r).toHaveLength(1);
    expect(r[0]?.name).toBe("Mahope (cvrapi)");
  });

  it("falder tilbage til cvrapi.dk, når tjenesten timer ud eller nøglen mangler", async () => {
    fetchMock
      .mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"))
      .mockResolvedValueOnce(json(cvrapi));
    expect((await searchCVRMany("mahope"))[0]?.name).toBe("Mahope (cvrapi)");
    fetchMock.mockReset();
    vi.stubEnv("CVR_SERVICE_API_KEY", "");
    fetchMock.mockResolvedValueOnce(json(cvrapi));
    expect(await searchCVRMany("mahope")).toHaveLength(1);
    expect(calledUrl()).toContain("cvrapi.dk");
  });

  it("et telefonnummer går direkte til cvrapi.dk og giver højst ét træf", async () => {
    fetchMock.mockResolvedValueOnce(json(cvrapi));
    const r = await searchCVRMany("12 34 56 78 90");
    expect(calledUrl()).toContain("cvrapi.dk/api?phone=");
    expect(r).toHaveLength(1);
  });
});
