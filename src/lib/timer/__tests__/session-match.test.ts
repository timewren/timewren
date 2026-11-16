import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { classifyClaimMiss } from "../claim";
import {
  expectedStartSql,
  heartbeatSessionGuardSql,
  isLegacyNativeAppRequest,
  isSameSessionStart,
  SESSION_MATCH_TOLERANCE_SECONDS,
} from "../session-match";

const dialect = new PgDialect();
const render = (q: Parameters<PgDialect["sqlToQuery"]>[0]) =>
  dialect.sqlToQuery(q);

const start = new Date("2026-10-02T07:00:00.000Z");

describe("isSameSessionStart", () => {
  it("samme start (inden for tolerancen) er samme session", () => {
    expect(isSameSessionStart(start, start)).toBe(true);
    expect(
      isSameSessionStart(
        start,
        new Date(start.getTime() + SESSION_MATCH_TOLERANCE_SECONDS * 1000),
      ),
    ).toBe(true);
  });

  it("en anden start, en pause (ingen start) eller en ryddet række er IKKE samme session", () => {
    expect(isSameSessionStart(new Date("2026-10-02T08:05:00Z"), start)).toBe(
      false,
    );
    expect(isSameSessionStart(null, start)).toBe(false);
    expect(isSameSessionStart(undefined, start)).toBe(false);
  });
});

describe("expectedStartSql", () => {
  it("binder den forventede start som UTC-timestamp og kræver en start på rækken", () => {
    const q = render(expectedStartSql(start.getTime()));
    expect(q.sql).toContain('"timer_states"."start_time" IS NOT NULL');
    expect(q.sql).toContain("AT TIME ZONE 'UTC'");
    expect(q.params).toContain("2026-10-02T07:00:00.000Z");
  });
});

describe("heartbeatSessionGuardSql", () => {
  it("uden forventet start og fra web/extension: ingen ekstra vagt (uændret adfærd)", () => {
    expect(
      heartbeatSessionGuardSql({
        expectedStartTime: undefined,
        legacyNativeApp: false,
      }),
    ).toBeUndefined();
  });

  it("med forventet start: rækkens start skal matche den forventede", () => {
    const guard = heartbeatSessionGuardSql({
      expectedStartTime: start.getTime(),
      legacyNativeApp: false,
    });
    expect(guard).toBeDefined();
    expect(render(guard!).params).toContain("2026-10-02T07:00:00.000Z");
  });

  it("ældre mobil-build uden forventet start: heartbeatets egen start skal matche rækkens", () => {
    const guard = heartbeatSessionGuardSql({
      expectedStartTime: undefined,
      legacyNativeApp: true,
    });
    expect(guard).toBeDefined();
    const q = render(guard!);
    expect(q.sql).toContain("excluded.start_time");
    expect(q.sql).toContain('"timer_states"."start_time"');
  });
});

describe("isLegacyNativeAppRequest", () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it("genkender mobilappens fetch (cookie, ingen browser-UA, ingen Origin)", () => {
    expect(
      isLegacyNativeAppRequest(
        h({
          cookie: "x=y",
          "user-agent": "TimeTrack/3 CFNetwork/1568 Darwin/24",
        }),
      ),
    ).toBe(true);
    expect(
      isLegacyNativeAppRequest(
        h({ cookie: "x=y", "user-agent": "okhttp/4.12.0" }),
      ),
    ).toBe(true);
  });

  it("browsere, extension og API-nøgler er ikke mobilappen", () => {
    expect(
      isLegacyNativeAppRequest(
        h({
          cookie: "x=y",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130",
          origin: "https://app.timetrack.dk",
        }),
      ),
    ).toBe(false);
    expect(
      isLegacyNativeAppRequest(
        h({ cookie: "x=y", origin: "chrome-extension://abc" }),
      ),
    ).toBe(false);
    expect(
      isLegacyNativeAppRequest(
        h({ authorization: "Bearer tt_x", "user-agent": "curl/8" }),
      ),
    ).toBe(false);
    expect(isLegacyNativeAppRequest(null)).toBe(false);
    // Uden cookie er det ikke en logget-ind app-session.
    expect(isLegacyNativeAppRequest(h({ "user-agent": "okhttp/4" }))).toBe(
      false,
    );
  });
});

describe("classifyClaimMiss med forventet session", () => {
  const running = {
    isRunning: true,
    elapsedSeconds: 0,
    baseSeconds: 0,
    intent: null,
    intentFrom: null,
    version: 9,
  };

  it("kører en ANDEN session → session_mismatch (intet claim, ingen gemning)", () => {
    expect(
      classifyClaimMiss(
        { ...running, startTime: new Date("2026-10-02T08:05:00Z") },
        start.getTime(),
      ),
    ).toEqual({ success: false, reason: "session_mismatch", version: 9 });
  });

  it("en pause (ingen start) er heller ikke den forventede session", () => {
    expect(
      classifyClaimMiss(
        {
          ...running,
          isRunning: false,
          elapsedSeconds: 600,
          baseSeconds: 600,
          startTime: null,
        },
        start.getTime(),
      ),
    ).toEqual({ success: false, reason: "session_mismatch", version: 9 });
  });

  it("samme session men anden version → stadig version_mismatch", () => {
    expect(
      classifyClaimMiss({ ...running, startTime: start }, start.getTime()),
    ).toEqual({
      success: false,
      reason: "version_mismatch",
      version: 9,
    });
  });

  it("uden forventet start (web/extension/ældre builds) er klassifikationen uændret", () => {
    expect(
      classifyClaimMiss({
        ...running,
        startTime: new Date("2026-10-02T08:05:00Z"),
      }),
    ).toEqual({ success: false, reason: "version_mismatch", version: 9 });
  });
});
