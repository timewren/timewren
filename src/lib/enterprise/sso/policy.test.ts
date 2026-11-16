import { describe, expect, it } from "vitest";
import {
  callbackBypassesSso,
  callbackProviderId,
  isNonSsoSignInPath,
  shouldDeleteRejectedNewUser,
} from "./policy";

describe("isNonSsoSignInPath", () => {
  it("blokerer login med e-mail/adgangskode, signup, magic link og telefon", () => {
    for (const p of [
      "/sign-in/email",
      "/sign-up/email",
      "/sign-in/magic-link",
      "/sign-in/phone-number",
      "/phone-number/verify",
    ]) {
      expect(isNonSsoSignInPath(p)).toBe(true);
    }
  });
  it("undtager passkeys, sociale callbacks og Microsoft", () => {
    for (const p of [
      "/sign-in/passkey",
      "/sign-in/social",
      "/callback/:id",
      "/oauth2/callback/:providerId",
      "/sign-in/oauth2",
      "/get-session",
    ]) {
      expect(isNonSsoSignInPath(p)).toBe(false);
    }
  });
});

describe("callbackProviderId / callbackBypassesSso", () => {
  it("finder social provider fra /callback/:id", () => {
    expect(callbackProviderId("/callback/:id", { id: "google" })).toBe(
      "google",
    );
    expect(callbackBypassesSso("/callback/:id", { id: "google" })).toBe(true);
    expect(callbackBypassesSso("/callback/:id", { id: "github" })).toBe(true);
    expect(callbackBypassesSso("/callback/:id", { id: "discord" })).toBe(true);
  });
  it("lader Microsoft passere på /callback/:id (better-auth 1.7)", () => {
    expect(
      callbackProviderId("/callback/:id", { id: "microsoft-entra-id" }),
    ).toBe("microsoft-entra-id");
    expect(
      callbackBypassesSso("/callback/:id", { id: "microsoft-entra-id" }),
    ).toBe(false);
  });
  it("blokerer Apple og andre providers på /callback/:id", () => {
    expect(callbackBypassesSso("/callback/:id", { id: "apple" })).toBe(true);
    expect(callbackBypassesSso("/callback/:id", { id: "okta" })).toBe(true);
  });
  it("blokerer id-token-login på /sign-in/social fra andre end Microsoft", () => {
    expect(
      callbackProviderId("/sign-in/social", undefined, { provider: "apple" }),
    ).toBe("apple");
    expect(
      callbackBypassesSso("/sign-in/social", undefined, { provider: "google" }),
    ).toBe(true);
    expect(
      callbackBypassesSso("/sign-in/social", undefined, {
        provider: "microsoft-entra-id",
      }),
    ).toBe(false);
    expect(callbackBypassesSso("/sign-in/social", undefined, {})).toBe(false);
  });
  it("ignorerer den gamle generic-oauth-sti fra 1.6", () => {
    expect(
      callbackProviderId("/oauth2/callback/:providerId", {
        providerId: "okta",
      }),
    ).toBeNull();
  });
  it("ignorerer ikke-callback-stier og manglende params", () => {
    expect(callbackProviderId("/get-session", undefined)).toBeNull();
    expect(callbackBypassesSso("/callback/:id", undefined)).toBe(false);
  });
});

describe("shouldDeleteRejectedNewUser", () => {
  const now = new Date("2026-08-31T12:00:00Z");
  it("sletter kun helt nye brugere uden medlemskaber", () => {
    expect(
      shouldDeleteRejectedNewUser({
        accountCount: 1,
        membershipCount: 0,
        createdAt: new Date(now.getTime() - 5_000),
        now,
      }),
    ).toBe(true);
  });
  it("rører ikke eksisterende brugere", () => {
    expect(
      shouldDeleteRejectedNewUser({
        accountCount: 2,
        membershipCount: 0,
        createdAt: new Date(now.getTime() - 5_000),
        now,
      }),
    ).toBe(false);
    expect(
      shouldDeleteRejectedNewUser({
        accountCount: 1,
        membershipCount: 1,
        createdAt: new Date(now.getTime() - 5_000),
        now,
      }),
    ).toBe(false);
    expect(
      shouldDeleteRejectedNewUser({
        accountCount: 1,
        membershipCount: 0,
        createdAt: new Date(now.getTime() - 60 * 60 * 1000),
        now,
      }),
    ).toBe(false);
  });
});
