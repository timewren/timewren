import { describe, expect, it } from "vitest";
import {
  appCodeFromErrorBody,
  CLIENT_TOO_OLD,
  clientHeaders,
  liveSaves,
  nextUpdateCheckAt,
  SAVE_IN_FLIGHT_TTL_MS,
  shouldDeferReload,
  shouldRequestUpdateCheck,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_THROTTLED_BACKOFF_MS,
} from "./client-version";

describe("clientHeaders", () => {
  it("sender extension/<version>", () => {
    expect(clientHeaders("2.5.2")).toEqual({
      "x-timetrack-client": "extension/2.5.2",
    });
  });
});

describe("appCodeFromErrorBody", () => {
  it("læser tRPC-svar med superjson", () => {
    expect(
      appCodeFromErrorBody({
        error: {
          json: {
            message: "Din TimeTrack-udvidelse er for gammel",
            code: -32012,
            data: { code: "PRECONDITION_FAILED", appCode: CLIENT_TOO_OLD },
          },
        },
      }),
    ).toBe(CLIENT_TOO_OLD);
  });

  it("læser REST-svar", () => {
    expect(
      appCodeFromErrorBody({ error: { code: "CLIENT_TOO_OLD", message: "x" } }),
    ).toBe(CLIENT_TOO_OLD);
  });

  it("andre fejl giver null", () => {
    expect(
      appCodeFromErrorBody({
        error: { json: { data: { code: "FORBIDDEN" } } },
      }),
    ).toBeNull();
    expect(appCodeFromErrorBody(null)).toBeNull();
    expect(appCodeFromErrorBody("<html>")).toBeNull();
  });
});

describe("opdateringstjek", () => {
  it("respekterer vores eget interval", () => {
    expect(shouldRequestUpdateCheck(null, 1000)).toBe(true);
    expect(shouldRequestUpdateCheck(2000, 1000)).toBe(false);
    expect(shouldRequestUpdateCheck(2000, 2000)).toBe(true);
  });

  it("venter længere når Chrome svarer throttled", () => {
    expect(nextUpdateCheckAt("no_update", 0)).toBe(UPDATE_CHECK_INTERVAL_MS);
    expect(nextUpdateCheckAt("throttled", 0)).toBe(
      UPDATE_CHECK_THROTTLED_BACKOFF_MS,
    );
  });
});

describe("liveSaves", () => {
  it("dropper gem der er for gamle til at tælle", () => {
    const now = 100_000;
    expect(
      liveSaves({ a: now - 1000, b: now - SAVE_IN_FLIGHT_TTL_MS - 1 }, now),
    ).toEqual({ a: now - 1000 });
    expect(liveSaves(undefined, now)).toEqual({});
  });
});

describe("shouldDeferReload", () => {
  it("venter mens popup'en er åben — også efter fristen (ugemt formular)", () => {
    expect(
      shouldDeferReload({
        savesInFlight: 0,
        popupOpen: true,
        now: 10,
        deadline: 5,
      }),
    ).toBe(true);
  });

  it("venter på gem indtil fristen", () => {
    expect(
      shouldDeferReload({
        savesInFlight: 1,
        popupOpen: false,
        now: 1,
        deadline: 5,
      }),
    ).toBe(true);
    expect(
      shouldDeferReload({
        savesInFlight: 1,
        popupOpen: false,
        now: 6,
        deadline: 5,
      }),
    ).toBe(false);
  });

  it("genstarter når intet er i gang", () => {
    expect(
      shouldDeferReload({
        savesInFlight: 0,
        popupOpen: false,
        now: 1,
        deadline: 5,
      }),
    ).toBe(false);
  });
});
