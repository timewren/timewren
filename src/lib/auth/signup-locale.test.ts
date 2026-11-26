import { describe, expect, it } from "vitest";
import { signupLocaleFromRequest } from "./signup-locale";

const req = (h: Record<string, string>) => new Headers(h);

describe("signupLocaleFromRequest", () => {
  it("følger en engelsk browser, så appen ikke skifter til dansk efter login", () => {
    expect(
      signupLocaleFromRequest(
        req({ "accept-language": "en-US,en;q=0.9" }),
        "timewren",
      ),
    ).toBe("en");
  });

  it("lader sprogvælgerens cookie vinde over browserens sprog", () => {
    expect(
      signupLocaleFromRequest(
        req({
          cookie: "tt_consent=x; locale=da",
          "accept-language": "en-US,en;q=0.9",
        }),
        "timewren",
      ),
    ).toBe("da");
  });

  it("begrænser til instansens sprog (TimeTrack har ikke svensk)", () => {
    expect(
      signupLocaleFromRequest(req({ "accept-language": "sv-SE" }), "timetrack"),
    ).toBeNull();
    expect(
      signupLocaleFromRequest(req({ "accept-language": "sv-SE" }), "timewren"),
    ).toBe("sv");
  });

  it("ignorerer en ukendt cookie og falder tilbage til Accept-Language", () => {
    expect(
      signupLocaleFromRequest(
        req({ cookie: "locale=xx", "accept-language": "de-DE" }),
        "timetrack",
      ),
    ).toBe("de");
  });

  it("giver null uden signal, så kolonnens default bliver stående", () => {
    expect(signupLocaleFromRequest(req({}), "timetrack")).toBeNull();
    expect(signupLocaleFromRequest(undefined, "timetrack")).toBeNull();
  });
});
