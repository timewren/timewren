import { describe, expect, it } from "vitest";
import {
  isPortalSessionKey,
  PORTAL_SESSION_KEY,
  portalSessionKey,
} from "../session-key";

describe("portalSessionKey", () => {
  it("scoper nøglen pr. token", () => {
    const key = portalSessionKey("abc");
    expect(key).toMatch(/^portalSession:[0-9a-f]+$/);
  });

  it("giver forskellige nøgler for forskellige tokens", () => {
    expect(portalSessionKey("kunde-a")).not.toBe(portalSessionKey("kunde-b"));
  });

  it("er stabil for det samme token", () => {
    expect(portalSessionKey("abc")).toBe(portalSessionKey("abc"));
  });

  it("lægger ikke token'et i klartekst i nøglenavnet", () => {
    const token = "hemmeligt-access-token-42";
    expect(portalSessionKey(token)).not.toContain(token);
  });

  it("giver ingen nøgle for et blankt token", () => {
    // Ellers ville /portal/t/%20 falde tilbage til den generiske nøgle og
    // genbruge en fremmed kundes session.
    expect(portalSessionKey("")).toBeNull();
    expect(portalSessionKey("   ")).toBeNull();
  });

  it("aldrig er lig den generiske nøgle", () => {
    expect(portalSessionKey("abc")).not.toBe(PORTAL_SESSION_KEY);
  });

  it("trimmer whitespace omkring token", () => {
    expect(portalSessionKey(" abc ")).toBe(portalSessionKey("abc"));
  });
});

describe("isPortalSessionKey", () => {
  it("genkender både den generiske og de scopede nøgler", () => {
    expect(isPortalSessionKey(PORTAL_SESSION_KEY)).toBe(true);
    expect(isPortalSessionKey(portalSessionKey("abc") as string)).toBe(true);
  });

  it("rører ikke andre localStorage-nøgler", () => {
    expect(isPortalSessionKey("theme")).toBe(false);
    expect(isPortalSessionKey("myPortalSession")).toBe(false);
  });
});
