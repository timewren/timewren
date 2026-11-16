import { describe, expect, it } from "vitest";
import { normalizeClientDomains } from "../domains";

describe("normalizeClientDomains", () => {
  it("normaliserer som reglerne og fjerner dubletter", () => {
    expect(
      normalizeClientDomains([
        "WWW.Bageriet.dk",
        "https://bageriet.dk/kontakt",
        "shop.bageriet.dk",
        " bageriet.dk ",
      ]),
    ).toEqual({ domains: ["bageriet.dk", "shop.bageriet.dk"], invalid: [] });
  });

  it("returnerer ugyldige domæner", () => {
    expect(normalizeClientDomains(["localhost", "ikke et domæne", ""])).toEqual(
      { domains: [], invalid: ["localhost", "ikke et domæne", ""] },
    );
  });
});
