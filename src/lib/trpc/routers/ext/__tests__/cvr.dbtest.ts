/**
 * extension.cvr.*: CVR-opslag og navneforslag for token-klienter (desktop).
 * CVR-tjenesten mockes på fetch; nøglen læses kun fra serverens env.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceCaller, seedAccount } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

const virksomhed = {
  cvr: "39413892",
  navn: "Mahope",
  adresse: { vej: "Testvej", husnummer: "1", postnr: "8000", by: "Aarhus C" },
  aktiv: true,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

describe.skipIf(!enabled)("extension.cvr (token-API)", () => {
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

  it("slår et CVR-nummer op med token og giver felterne til kundeformularen", async () => {
    const acc = await seedAccount();
    fetchMock.mockResolvedValueOnce(json(virksomhed));
    const r = await deviceCaller().extension.cvr.lookup({
      token: acc.token,
      cvrNumber: "39 41 38 92",
    });
    expect(r).toMatchObject({
      cvrNumber: "39413892",
      name: "Mahope",
      address: "Testvej 1",
      postalCode: "8000",
      city: "Aarhus C",
    });
  });

  it("giver NOT_FOUND, når CVR-nummeret ikke findes", async () => {
    const acc = await seedAccount();
    fetchMock.mockResolvedValueOnce(json({ fejl: "Ikke fundet" }, 404));
    const err = await errorOf(
      deviceCaller().extension.cvr.lookup({
        token: acc.token,
        cvrNumber: "12345678",
      }),
    );
    expect(err.code).toBe("NOT_FOUND");
  });

  it("navnesøgning giver en liste af forslag", async () => {
    const acc = await seedAccount();
    fetchMock.mockResolvedValueOnce(
      json({
        resultater: [
          { virksomhed },
          { virksomhed: { ...virksomhed, cvr: "11111111", navn: "Mahope 2" } },
        ],
      }),
    );
    const r = await deviceCaller().extension.cvr.search({
      token: acc.token,
      query: "mahope",
    });
    expect(r.map((c) => c.name)).toEqual(["Mahope", "Mahope 2"]);
  });

  it("afviser kald uden gyldigt token", async () => {
    const err = await errorOf(
      deviceCaller().extension.cvr.search({
        token: "ugyldig",
        query: "mahope",
      }),
    );
    expect(err.code).toBe("UNAUTHORIZED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
