import { describe, expect, it } from "vitest";
import {
  buildTwoFactorUrl,
  parseTwoFactorMethods,
  RATE_LIMIT_MESSAGE,
  safeRedirectPath,
  translateAuthError,
} from "./login-helpers";

describe("safeRedirectPath", () => {
  it("accepterer interne stier inkl. query", () => {
    expect(safeRedirectPath("/dashboard/time")).toBe("/dashboard/time");
    expect(
      safeRedirectPath("/auth/desktop?callback=timetrack%3A%2F%2Fauth"),
    ).toBe("/auth/desktop?callback=timetrack%3A%2F%2Fauth");
  });

  it("falder tilbage ved tom værdi", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard/start");
    expect(safeRedirectPath(undefined)).toBe("/dashboard/start");
    expect(safeRedirectPath("")).toBe("/dashboard/start");
  });

  it.each([
    "https://evil.dk",
    "//evil.dk",
    "/\\evil.dk",
    "\\\\evil.dk",
    "javascript:alert(1)",
    "dashboard",
    "/\tevil",
    "/foo\\bar",
  ])("afviser %j", (raw) => {
    expect(safeRedirectPath(raw)).toBe("/dashboard/start");
  });

  it("bruger eget fallback", () => {
    expect(safeRedirectPath("//evil.dk", "/login")).toBe("/login");
  });
});

describe("buildTwoFactorUrl", () => {
  it("udelader standard-redirect", () => {
    expect(buildTwoFactorUrl("/dashboard/start", ["totp", "otp"])).toBe(
      "/login/two-factor?methods=totp%2Cotp",
    );
    expect(buildTwoFactorUrl(null)).toBe("/login/two-factor");
  });

  it("bevarer intern redirect", () => {
    expect(buildTwoFactorUrl("/auth/extension?redirect_uri=x", ["otp"])).toBe(
      "/login/two-factor?redirect=%2Fauth%2Fextension%3Fredirect_uri%3Dx&methods=otp",
    );
  });

  it("dropper ekstern redirect og ukendte metoder", () => {
    expect(buildTwoFactorUrl("//evil.dk", ["sms", "totp"])).toBe(
      "/login/two-factor?methods=totp",
    );
  });
});

describe("parseTwoFactorMethods", () => {
  it("læser kendte metoder og falder tilbage til totp", () => {
    expect(parseTwoFactorMethods("totp,otp")).toEqual(["totp", "otp"]);
    expect(parseTwoFactorMethods("otp")).toEqual(["otp"]);
    expect(parseTwoFactorMethods("sms")).toEqual(["totp"]);
    expect(parseTwoFactorMethods(null)).toEqual(["totp"]);
  });
});

describe("translateAuthError", () => {
  it("oversætter på fejlkode", () => {
    expect(
      translateAuthError({
        code: "INVALID_EMAIL_OR_PASSWORD",
        message: "Invalid email or password",
        status: 401,
      }),
    ).toBe("Forkert e-mail eller adgangskode.");
    expect(translateAuthError({ code: "INVALID_CODE" })).toBe(
      "Koden er forkert. Prøv igen.",
    );
  });

  it("oversætter på engelsk besked uden kode", () => {
    expect(translateAuthError({ message: "Invalid email or password" })).toBe(
      "Forkert e-mail eller adgangskode.",
    );
    expect(translateAuthError({ message: "Email not verified." })).toBe(
      "Din e-mail er ikke bekræftet endnu. Tjek din indbakke for bekræftelsesmailen.",
    );
  });

  it("login på forkert brand: neutral besked, der ikke nævner det andet brand", () => {
    const da = "Vi kan ikke finde en konto med de oplysninger her.";
    expect(
      translateAuthError({
        code: "ACCOUNT_NOT_ON_THIS_SITE",
        message: "We could not find an account with those details here.",
        status: 401,
      }),
    ).toBe(da);
    expect(
      translateAuthError({
        message: "We could not find an account with those details here.",
      }),
    ).toBe(da);
  });

  it("giver rate-limit-besked ved 429", () => {
    expect(
      translateAuthError({
        status: 429,
        message: "Too many requests. Please try again later.",
      }),
    ).toBe(RATE_LIMIT_MESSAGE);
    expect(
      translateAuthError({
        message: "Too many requests. Please try again later.",
      }),
    ).toBe(RATE_LIMIT_MESSAGE);
  });

  it("sender ukendte (egne danske) beskeder uændret videre", () => {
    const sso =
      "Jeres organisation kræver login med Microsoft. Brug knappen 'Log ind med Microsoft'.";
    expect(translateAuthError({ code: "FORBIDDEN", message: sso })).toBe(sso);
  });

  it("bruger fallback når der ingen besked er", () => {
    expect(translateAuthError(null, "Øv")).toBe("Øv");
    expect(translateAuthError({ message: "  " }, "Øv")).toBe("Øv");
  });
});
