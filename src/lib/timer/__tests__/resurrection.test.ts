import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  clearedRowSql,
  isClearedTimerRow,
  isStaleStartOnClearedRow,
  noResurrectionGuardSql,
  RESURRECTION_TOLERANCE_SECONDS,
  staleStartSql,
  startCoveredBySavedEntrySql,
} from "../resurrection";

const dialect = new PgDialect();
const render = (q: Parameters<PgDialect["sqlToQuery"]>[0]) =>
  dialect.sqlToQuery(q).sql;

const clearedAt = new Date("2026-10-01T07:34:10Z");
const clearedRow = {
  isRunning: false,
  elapsedSeconds: 0,
  baseSeconds: 0,
  lastSyncedAt: clearedAt,
  updatedAt: clearedAt,
};

describe("isClearedTimerRow", () => {
  it("er kun ryddet når intet kører og ingen tid står på rækken", () => {
    expect(isClearedTimerRow(clearedRow)).toBe(true);
    expect(isClearedTimerRow({ ...clearedRow, isRunning: true })).toBe(false);
    expect(isClearedTimerRow({ ...clearedRow, elapsedSeconds: 60 })).toBe(
      false,
    );
    expect(isClearedTimerRow({ ...clearedRow, baseSeconds: 60 })).toBe(false);
    expect(
      isClearedTimerRow({
        isRunning: null,
        elapsedSeconds: null,
        baseSeconds: null,
      }),
    ).toBe(true);
  });
});

describe("pause efter 0 sekunder", () => {
  it("en pauset række med projekt/kunde er ikke ryddet, selv uden tid", () => {
    expect(
      isClearedTimerRow({ ...clearedRow, projectId: "p-1", clientId: null }),
    ).toBe(false);
    expect(
      isClearedTimerRow({ ...clearedRow, projectId: null, clientId: "c-1" }),
    ).toBe(false);
  });

  it("ryddet-prædikatet kræver også at projekt og kunde er tomme", () => {
    const sql = render(clearedRowSql());
    expect(sql).toContain('"timer_states"."project_id" IS NULL');
    expect(sql).toContain('"timer_states"."client_id" IS NULL');
  });
});

describe("isStaleStartOnClearedRow", () => {
  it("afviser en genopstanden session med starttid fra før stoppet (kunde A 07:02:54)", () => {
    expect(
      isStaleStartOnClearedRow(clearedRow, new Date("2026-10-01T07:02:54Z")),
    ).toBe(true);
  });

  it("tillader en ægte ny start (starttid ≈ nu)", () => {
    expect(
      isStaleStartOnClearedRow(clearedRow, new Date("2026-10-01T07:40:00Z")),
    ).toBe(false);
  });

  it("tolerancen er mindst 5 min (ur-skævhed; prod-genopstandelser var 30+ min)", () => {
    expect(RESURRECTION_TOLERANCE_SECONDS).toBeGreaterThanOrEqual(300);
  });

  it("tåler lidt ur-skævhed mellem klient og server", () => {
    const justBefore = new Date(
      clearedAt.getTime() - (RESURRECTION_TOLERANCE_SECONDS - 5) * 1000,
    );
    expect(isStaleStartOnClearedRow(clearedRow, justBefore)).toBe(false);
  });

  it("tillader en offline-afspillet start, der er lavet EFTER sidste stop", () => {
    expect(
      isStaleStartOnClearedRow(clearedRow, new Date("2026-10-01T08:00:00Z")),
    ).toBe(false);
  });

  it("offline stop→start afspillet senere: starten ligger efter den gemte post → tilladt", () => {
    // Stop A og start B kl. 10:00 offline; køen afspilles 10:20, så stoppet
    // rydder rækken EFTER B's starttid. B ligger ikke inde i A's post.
    const replayCleared = {
      ...clearedRow,
      lastSyncedAt: new Date("2026-10-01T10:20:00Z"),
    };
    expect(
      isStaleStartOnClearedRow(
        replayCleared,
        new Date("2026-10-01T10:00:00Z"),
        false,
      ),
    ).toBe(false);
  });

  it("afviser en kørende skrivning uden starttid på en ryddet række", () => {
    expect(isStaleStartOnClearedRow(clearedRow, null)).toBe(true);
  });

  it("gælder ikke rækker der kører eller er pauset", () => {
    const old = new Date("2026-10-01T07:02:54Z");
    expect(
      isStaleStartOnClearedRow({ ...clearedRow, isRunning: true }, old),
    ).toBe(false);
    expect(
      isStaleStartOnClearedRow({ ...clearedRow, baseSeconds: 600 }, old),
    ).toBe(false);
  });

  it("falder tilbage til updatedAt når lastSyncedAt mangler", () => {
    expect(
      isStaleStartOnClearedRow(
        { ...clearedRow, lastSyncedAt: null },
        new Date("2026-10-01T07:02:54Z"),
      ),
    ).toBe(true);
  });
});

describe("SQL-guards (atomiske prædikater i upsertens setWhere)", () => {
  it("ryddet-række-prædikatet ser på run-state og begge tidsfelter", () => {
    const sql = render(clearedRowSql());
    expect(sql).toContain('"timer_states"."is_running"');
    expect(sql).toContain('"timer_states"."elapsed_seconds"');
    expect(sql).toContain('"timer_states"."base_seconds"');
  });

  it("sammenligner den FORESLÅEDE starttid (excluded) med rydningstidspunktet", () => {
    const sql = render(staleStartSql());
    expect(sql).toContain("excluded.start_time");
    expect(sql).toContain('"timer_states"."last_synced_at"');
    expect(sql).toContain('"timer_states"."updated_at"');
    expect(sql).toContain(`${RESURRECTION_TOLERANCE_SECONDS} seconds`);
  });

  it("den gemte post findes med en atomisk underforespørgsel på brugerens poster", () => {
    const sql = render(startCoveredBySavedEntrySql());
    expect(sql).toContain("EXISTS (SELECT 1 FROM");
    expect(sql).toContain(
      '"time_entries"."user_id" = "timer_states"."user_id"',
    );
    expect(sql).toContain('"time_entries"."end_time" > excluded.start_time');
  });

  it("guarden er NULL-sikker (en NULL må aldrig blokere en gyldig skrivning)", () => {
    const sql = render(noResurrectionGuardSql());
    expect(sql.startsWith("NOT COALESCE(")).toBe(true);
    expect(sql.trimEnd().endsWith(", false)")).toBe(true);
  });
});
