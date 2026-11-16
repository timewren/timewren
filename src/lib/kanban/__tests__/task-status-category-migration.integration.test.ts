/**
 * INTEGRATION: migration 0155 (kategori på kanban-kolonner) skal være
 * additiv og bevare betydningen af alle eksisterende kolonner og opgaver.
 *
 * Kører den rigtige SQL-fil mod en scratch-schema med task_statuses og
 * tasks, som de så ud før migrationen. Kører kun med TEST_DATABASE_URL.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const MIGRATION = readFileSync(
  join(process.cwd(), "drizzle", "0155_task_status_category.sql"),
  "utf8",
);

describe.skipIf(!TEST_DATABASE_URL)(
  "migration 0155_task_status_category (integration)",
  () => {
    const scratch = `lane_category_mig_it_${Date.now()}`;
    const sql = testPostgres({
      max: 1,
      onnotice: () => {},
      connection: { search_path: scratch },
    });

    async function migrate() {
      for (const statement of MIGRATION.split("--> statement-breakpoint")) {
        if (statement.trim()) await sql.unsafe(statement);
      }
    }

    beforeAll(async () => {
      await connectTestDb(sql);
      await sql.unsafe(`CREATE SCHEMA ${scratch}`);
      // Tabellerne som før migrationen (uden category).
      await sql.unsafe(`
        CREATE TABLE task_statuses (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id text NOT NULL,
          organization_id text,
          scope varchar(10) NOT NULL,
          project_id uuid,
          name varchar(50) NOT NULL,
          color varchar(7) NOT NULL,
          "order" integer NOT NULL DEFAULT 0,
          is_archive boolean NOT NULL DEFAULT false
        );
        CREATE TABLE tasks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          title text NOT NULL,
          status varchar(20) NOT NULL DEFAULT 'backlog',
          status_id uuid,
          completed_at timestamp
        );
      `);
      await sql`
        INSERT INTO task_statuses (user_id, scope, name, color, "order", is_archive) VALUES
          ('u1', 'general', 'Backlog', '#9ca3af', 0, false),
          ('u1', 'general', 'Todo', '#3b82f6', 1, false),
          ('u1', 'general', 'I gang', '#f59e0b', 2, false),
          ('u1', 'general', 'Afsluttet', '#10b981', 3, true),
          ('u2', 'general', 'Afventer korrektur', '#8b5cf6', 0, false),
          ('u2', 'general', 'Faktureres', '#10b981', 1, true)
      `;
      await sql`
        INSERT INTO tasks (title, status, status_id, completed_at)
        SELECT 'opg-' || name, 'todo', id, NULL FROM task_statuses
      `;
    });

    afterAll(async () => {
      await sql.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await sql.end();
    });

    it("giver hver eksisterende kolonne den kategori, dens adfærd svarer til", async () => {
      await migrate();
      const rows = await sql<{ name: string; category: string }[]>`
        SELECT name, category FROM task_statuses ORDER BY user_id, "order"`;
      expect(rows.map((r) => [r.name, r.category])).toEqual([
        ["Backlog", "not_started"],
        ["Todo", "not_started"],
        ["I gang", "in_progress"],
        ["Afsluttet", "done"],
        ["Afventer korrektur", "not_started"],
        ["Faktureres", "done"],
      ]);
    });

    it("rører ingen opgaver", async () => {
      const rows = await sql<{ status: string; completed_at: Date | null }[]>`
        SELECT status, completed_at FROM tasks`;
      expect(rows).toHaveLength(6);
      expect(
        rows.every((r) => r.status === "todo" && r.completed_at === null),
      ).toBe(true);
    });

    it("er idempotent og overskriver ikke en kategori, brugeren har valgt", async () => {
      await sql`UPDATE task_statuses SET category = 'in_progress' WHERE name = 'Afventer korrektur'`;
      await sql`UPDATE task_statuses SET category = 'cancelled' WHERE name = 'Faktureres'`;
      await migrate();
      const rows = await sql<{ name: string; category: string }[]>`
        SELECT name, category FROM task_statuses WHERE user_id = 'u2' ORDER BY "order"`;
      expect(rows.map((r) => [r.name, r.category])).toEqual([
        ["Afventer korrektur", "in_progress"],
        ["Faktureres", "cancelled"],
      ]);
    });

    it("nye kolonner får not_started som default", async () => {
      const [row] = await sql<{ category: string }[]>`
        INSERT INTO task_statuses (user_id, scope, name, color)
        VALUES ('u3', 'general', 'Ny', '#000000') RETURNING category`;
      expect(row.category).toBe("not_started");
    });
  },
);
