import { describe, expect, it } from "vitest";
import {
  GOOGLE_SCOPE_CALENDAR_EVENTS,
  GOOGLE_SCOPE_CALENDAR_READONLY,
  GOOGLE_SCOPE_USERINFO_EMAIL,
  getAuthScopes,
  getCalendarAccessLevel,
  hasCalendarWriteAccess,
  normalizeGrantedScopes,
  parseScopes,
  syncDirectionRequiresWrite,
} from "./google-calendar-scopes";

describe("getAuthScopes", () => {
  it("beder som standard kun om læseadgang og e-mail", () => {
    const scopes = getAuthScopes();
    expect(scopes).toEqual([
      GOOGLE_SCOPE_CALENDAR_READONLY,
      GOOGLE_SCOPE_USERINFO_EMAIL,
    ]);
    expect(scopes).not.toContain(GOOGLE_SCOPE_CALENDAR_EVENTS);
  });

  it("tilføjer calendar.events når der bedes om skriveadgang", () => {
    expect(getAuthScopes({ write: true })).toEqual([
      GOOGLE_SCOPE_CALENDAR_READONLY,
      GOOGLE_SCOPE_USERINFO_EMAIL,
      GOOGLE_SCOPE_CALENDAR_EVENTS,
    ]);
  });

  it("returnerer en ny liste hver gang", () => {
    const a = getAuthScopes();
    a.push("x");
    expect(getAuthScopes()).not.toContain("x");
  });
});

describe("parseScopes / normalizeGrantedScopes", () => {
  it("splitter Googles mellemrumsadskilte streng og fjerner dubletter", () => {
    expect(
      parseScopes(
        `${GOOGLE_SCOPE_CALENDAR_READONLY}  openid ${GOOGLE_SCOPE_CALENDAR_READONLY}`,
      ),
    ).toEqual([GOOGLE_SCOPE_CALENDAR_READONLY, "openid"]);
  });

  it("håndterer tomme værdier", () => {
    expect(parseScopes(null)).toEqual([]);
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes("  ")).toEqual([]);
    expect(normalizeGrantedScopes(undefined)).toBeNull();
    expect(normalizeGrantedScopes("")).toBeNull();
  });

  it("normaliserer til sorteret, deterministisk streng", () => {
    expect(
      normalizeGrantedScopes(
        `${GOOGLE_SCOPE_USERINFO_EMAIL} ${GOOGLE_SCOPE_CALENDAR_READONLY}`,
      ),
    ).toBe(`${GOOGLE_SCOPE_CALENDAR_READONLY} ${GOOGLE_SCOPE_USERINFO_EMAIL}`);
  });
});

describe("hasCalendarWriteAccess / getCalendarAccessLevel", () => {
  it("read-only-forbindelse har ikke skriveadgang", () => {
    const granted = `${GOOGLE_SCOPE_CALENDAR_READONLY} ${GOOGLE_SCOPE_USERINFO_EMAIL}`;
    expect(hasCalendarWriteAccess(granted)).toBe(false);
    expect(getCalendarAccessLevel(granted)).toBe("read");
  });

  it("calendar.events giver skriveadgang", () => {
    const granted = `${GOOGLE_SCOPE_CALENDAR_READONLY} ${GOOGLE_SCOPE_CALENDAR_EVENTS}`;
    expect(hasCalendarWriteAccess(granted)).toBe(true);
    expect(getCalendarAccessLevel(granted)).toBe("read_write");
  });

  it("fuld calendar-scope tæller som skriveadgang", () => {
    expect(
      hasCalendarWriteAccess("https://www.googleapis.com/auth/calendar"),
    ).toBe(true);
  });

  it("calendar.events.readonly er ikke skriveadgang", () => {
    expect(
      hasCalendarWriteAccess(
        "https://www.googleapis.com/auth/calendar.events.readonly",
      ),
    ).toBe(false);
  });

  it("eksisterende forbindelser uden registrerede scopes beholder skriveadgang", () => {
    expect(hasCalendarWriteAccess(null)).toBe(true);
    expect(hasCalendarWriteAccess(undefined)).toBe(true);
    expect(getCalendarAccessLevel(null)).toBe("read_write");
  });

  it("tom registreret scope-streng er ikke skriveadgang", () => {
    expect(hasCalendarWriteAccess("")).toBe(false);
  });
});

describe("syncDirectionRequiresWrite", () => {
  it("kun outbound og both kræver skriveadgang", () => {
    expect(syncDirectionRequiresWrite("inbound")).toBe(false);
    expect(syncDirectionRequiresWrite("outbound")).toBe(true);
    expect(syncDirectionRequiresWrite("both")).toBe(true);
    expect(syncDirectionRequiresWrite(null)).toBe(false);
    expect(syncDirectionRequiresWrite(undefined)).toBe(false);
  });
});
