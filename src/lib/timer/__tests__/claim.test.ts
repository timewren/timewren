import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { classifyClaimMiss, hasSomethingToStopSql } from "../claim";

const dialect = new PgDialect();

describe("classifyClaimMiss", () => {
  it("ingen række → no_timer", () => {
    expect(classifyClaimMiss(undefined)).toEqual({
      success: false,
      reason: "no_timer",
      version: 0,
    });
  });

  it("et stop i gang vinder over alt andet", () => {
    expect(
      classifyClaimMiss({
        isRunning: true,
        elapsedSeconds: 0,
        baseSeconds: 0,
        intent: "stopping",
        intentFrom: "web",
        version: 7,
      }),
    ).toEqual({
      success: false,
      reason: "already_stopping",
      version: 7,
      stoppedBy: "web",
    });
  });

  it("en ryddet række har intet at stoppe → no_timer (ingen dobbelt-gem)", () => {
    expect(
      classifyClaimMiss({
        isRunning: false,
        elapsedSeconds: 0,
        baseSeconds: 0,
        intent: null,
        intentFrom: null,
        version: 12,
      }),
    ).toEqual({ success: false, reason: "no_timer", version: 12 });
  });

  it("en kørende eller pauset række med anden version → version_mismatch", () => {
    for (const row of [
      { isRunning: true, elapsedSeconds: 0, baseSeconds: 0 },
      { isRunning: false, elapsedSeconds: 600, baseSeconds: 600 },
    ]) {
      expect(
        classifyClaimMiss({
          ...row,
          intent: null,
          intentFrom: null,
          version: 3,
        }),
      ).toEqual({ success: false, reason: "version_mismatch", version: 3 });
    }
  });

  it("med sessionId: en ANDEN session på rækken → session_mismatch (#788)", () => {
    const row = {
      isRunning: true,
      elapsedSeconds: 0,
      baseSeconds: 0,
      intent: null,
      intentFrom: null,
      version: 9,
      currentSessionId: "s-ny",
    };
    expect(classifyClaimMiss(row, undefined, "s-gammel")).toEqual({
      success: false,
      reason: "session_mismatch",
      version: 9,
    });
    // Samme session, anden version → version_mismatch (klienten prøver igen)
    expect(classifyClaimMiss(row, undefined, "s-ny")).toEqual({
      success: false,
      reason: "version_mismatch",
      version: 9,
    });
    // Et stop i gang rapporteres stadig først
    expect(
      classifyClaimMiss(
        { ...row, intent: "stopping", intentFrom: "extension" },
        undefined,
        "s-gammel",
      ),
    ).toMatchObject({ reason: "already_stopping" });
  });
});

describe("hasSomethingToStopSql", () => {
  it("kræver kørende timer eller tid på rækken", () => {
    const sql = dialect.sqlToQuery(hasSomethingToStopSql()).sql;
    expect(sql.startsWith("NOT ")).toBe(true);
    expect(sql).toContain('"timer_states"."is_running"');
    expect(sql).toContain('"timer_states"."elapsed_seconds"');
    expect(sql).toContain('"timer_states"."base_seconds"');
  });
});
