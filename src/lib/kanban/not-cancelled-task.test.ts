import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { tasks } from "@/lib/db/schema";
import { notCancelledTask } from "./lanes-server";

// db.query.tasks.findMany omskriver alle kolonner i en sql-skabelon til
// tabel-aliasset "tasks", også task_statuses' kolonner i underforespørgslen.
// Det gav `SELECT "tasks"."id" FROM "task_statuses" WHERE "tasks"."category"`,
// som fejlede i daily-digest-cron'en 9/11-26 (Sentry TIMETRACK-23).
// `.toSQL()` bygger SQL'en uden at røre en database.

process.env.DATABASE_URL ||= "postgres://probe:probe@127.0.0.1:5432/probe";

let db: typeof import("@/lib/db").db;

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
});

const subquery = (text: string) =>
  text.slice(text.indexOf("NOT IN (SELECT"), text.indexOf("'cancelled'"));

describe("notCancelledTask", () => {
  it("peger på task_statuses i underforespørgslen i en relationel forespørgsel", () => {
    const { sql } = db.query.tasks
      .findMany({ where: and(eq(tasks.status, "done"), notCancelledTask()) })
      .toSQL();
    expect(subquery(sql)).not.toContain('"tasks".');
    expect(subquery(sql)).toContain('"task_statuses"."category"');
  });

  it("peger på task_statuses i en almindelig select", () => {
    const { sql } = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, "done"), notCancelledTask()))
      .toSQL();
    expect(subquery(sql)).not.toContain('"tasks".');
    expect(subquery(sql)).toContain('"task_statuses"."category"');
  });
});
