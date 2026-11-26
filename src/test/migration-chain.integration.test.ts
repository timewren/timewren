import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";
import { isolatedTestDatabase, testPostgres } from "./test-db";

const execFileAsync = promisify(execFile);

function migrationEnv(database: string): NodeJS.ProcessEnv {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  url.pathname = database;
  return {
    ...process.env,
    DATABASE_URL: url.toString(),
    NODE_ENV: "production",
    SEED_DEMO_ORGS: "",
    UNBLOCK_PLAN_EMAIL: "",
  };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("migration chain", () => {
  it.each(["db:migrate", "db:migrate-force"])(
    "%s builds the application schema from an empty database",
    async (command) => {
      const database = isolatedTestDatabase({ empty: true });
      const pg = testPostgres({ database: database.name, max: 1 });
      await database.create();
      try {
        const env = migrationEnv(database.name);
        const first = await execFileAsync("npm", ["run", command], { env });
        if (command === "db:migrate") {
          expect(first.stdout).toMatch(/\d+ new migration\(s\) applied/);
        }
        expect(await pg`SELECT id FROM "user"`).toEqual([]);
        expect(await pg`SELECT source FROM calendar_matching_rules`).toEqual(
          [],
        );
        expect(await pg`SELECT is_test_account FROM organizations`).toEqual([]);
        expect(
          await pg`
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'task_statuses'::regclass
            AND conname = 'task_statuses_scope_project_check'
            AND contype = 'c'
        `,
        ).toHaveLength(1);
        expect(
          await pg`
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'calendar_connections'::regclass
            AND confrelid = conrelid
            AND confdeltype = 'c'
            AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (parent_connection_id) REFERENCES calendar_connections(id)%'
        `,
        ).not.toHaveLength(0);
        const history = await pg<{ hash: string; created_at: string }[]>`
        SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id
      `;
        expect(history).toEqual(
          readMigrationFiles({ migrationsFolder: "./drizzle" }).map(
            ({ hash, folderMillis }) => ({
              hash,
              created_at: String(folderMillis),
            }),
          ),
        );
        const second = await execFileAsync("npm", ["run", "db:migrate"], {
          env,
        });
        expect(second.stdout).toContain("Database is up to date");

        expect(await pg`SELECT version FROM changelogs LIMIT 1`).toHaveLength(
          1,
        );
      } finally {
        await pg.end();
        await database.drop();
      }
    },
  );

  it.each([
    ["db:migrate", "missing"],
    ["db:migrate", "empty"],
    ["db:migrate", "missing 0161"],
    ["db:migrate", "missing 0160 and 0161"],
    ["db:migrate-force", "missing 0161"],
  ])(
    "%s preserves saved classifications with %s migration history",
    async (command, history) => {
      const database = isolatedTestDatabase();
      const pg = testPostgres({ database: database.name, max: 1 });
      await database.create();
      try {
        if (history === "missing") {
          await pg`DROP SCHEMA drizzle CASCADE`;
        } else if (history === "empty") {
          await pg`TRUNCATE drizzle.__drizzle_migrations`;
          await pg`DROP TABLE test_alunta_subscriptions`;
        } else {
          await pg`
            DELETE FROM drizzle.__drizzle_migrations
            WHERE created_at >= ${history === "missing 0161" ? 1795100000000 : 1795000000000}
          `;
        }

        await pg`
          INSERT INTO "user" (id, name, email) VALUES
            ('admin-a', 'Admin A', 'a@example.test'),
            ('admin-b', 'Admin B', 'b@example.test')
        `;
        await pg`
          INSERT INTO organizations (id, name, slug, is_test_account) VALUES
            ('real-org', 'Real org', 'real-org', false),
            ('test-org', 'Test org', 'test-org', true)
        `;
        await pg`
          INSERT INTO admin_activity_logs (admin_user_id, action, details, created_at)
          VALUES
            ('admin-a', 'set_test_account_flag', '{"organizationId":"real-org","testAccount":true}', '2026-01-01'),
            ('admin-b', 'set_test_account_flag', '{"organizationId":"real-org","testAccount":false}', '2026-01-02'),
            ('admin-a', 'set_test_account_flag', '{"organizationId":"test-org","testAccount":false}', '2026-01-01'),
            ('admin-b', 'set_test_account_flag', '{"organizationId":"test-org","testAccount":true}', '2026-01-02')
        `;
        await pg`DELETE FROM "user" WHERE id = 'admin-b'`;
        expect(await pg`SELECT admin_user_id FROM admin_activity_logs`).toEqual(
          [{ admin_user_id: "admin-a" }, { admin_user_id: "admin-a" }],
        );

        const env = migrationEnv(database.name);
        await execFileAsync("npm", ["run", command], { env });
        expect(
          await pg`SELECT id, is_test_account FROM organizations ORDER BY id`,
        ).toEqual([
          { id: "real-org", is_test_account: false },
          { id: "test-org", is_test_account: true },
        ]);
        expect(
          await pg`SELECT subscription_id FROM test_alunta_subscriptions`,
        ).toEqual([]);
        const [entry] = await pg`
          SELECT COUNT(*)::int AS count FROM drizzle.__drizzle_migrations
          WHERE created_at = 1795100000000
        `;
        expect(entry?.count).toBe(1);
        const second = await execFileAsync("npm", ["run", "db:migrate"], {
          env,
        });
        expect(second.stdout).toContain("Database is up to date");
      } finally {
        await pg.end();
        await database.drop();
      }
    },
  );

  it.each(["untracked", "tracked through 0159", "tracked through 0160"])(
    "recovers flags when the classification column is missing and the schema is %s",
    async (history) => {
      const database = isolatedTestDatabase();
      const pg = testPostgres({ database: database.name, max: 1 });
      await database.create();
      try {
        if (history === "untracked") {
          await pg`DROP SCHEMA drizzle CASCADE`;
        } else {
          await pg`
          DELETE FROM drizzle.__drizzle_migrations
          WHERE created_at >= ${history === "tracked through 0159" ? 1795000000000 : 1795100000000}
        `;
        }
        await pg`ALTER TABLE organizations DROP COLUMN is_test_account`;
        await pg`DROP TABLE test_alunta_subscriptions`;
        await pg`INSERT INTO "user" (id, name, email) VALUES ('test-admin', 'Test admin', 'admin@example.test')`;
        await pg`INSERT INTO organizations (id, name, slug) VALUES ('test-org', 'Test org', 'test-org')`;
        await pg`
        INSERT INTO admin_activity_logs (admin_user_id, action, details)
        VALUES ('test-admin', 'set_test_account_flag', '{"organizationId":"test-org","testAccount":true}')
      `;

        const { stdout } = await execFileAsync("npm", ["run", "db:migrate"], {
          env: migrationEnv(database.name),
        });
        expect(stdout).toMatch(/[1-9]\d* new migration\(s\) applied/);
        expect(
          await pg`SELECT is_test_account FROM organizations WHERE id = 'test-org'`,
        ).toEqual([{ is_test_account: true }]);
        expect(
          await pg`SELECT subscription_id FROM test_alunta_subscriptions`,
        ).toEqual([]);
      } finally {
        await pg.end();
        await database.drop();
      }
    },
  );

  describe("test-account flag rule", () => {
    // One rule for every path: the audit log is replayed only by the statement
    // that creates the flag column. Flags saved in an existing column are never
    // changed, even when a deleted administrator left the audit log stale.
    const states = [
      { name: "no history", column: true, drop: "history" },
      { name: "empty history", column: true, drop: "empty" },
      { name: "lost 0161 entry", column: true, drop: 1795100000000 },
      { name: "pending 0160 and 0161", column: true, drop: 1795000000000 },
      { name: "no history, column missing", column: false, drop: "history" },
      {
        name: "pending 0160, column missing",
        column: false,
        drop: 1795000000000,
      },
      {
        name: "pending 0161, column missing",
        column: false,
        drop: 1795100000000,
      },
      {
        name: "pending 0161, column created by 0160",
        column: true,
        drop: 1795100000000,
        marked: true,
        cleared: false,
      },
      {
        name: "pending 0161, column created by 0160, flag cleared in audit log",
        column: true,
        drop: 1795100000000,
        marked: true,
        cleared: true,
      },
      {
        name: "no history, column created by 0160",
        column: true,
        drop: "history",
        marked: true,
        cleared: false,
      },
    ] as const;
    const runs = [
      { run: "db:migrate", needsHistory: false },
      { run: "db:migrate-force", needsHistory: true },
      { run: "versioned SQL", needsHistory: false },
    ] as const;

    const cases = states.flatMap((state) =>
      runs
        .filter(
          ({ needsHistory }) => !needsHistory || typeof state.drop === "number",
        )
        .map(({ run }) => [run, state] as const),
    );

    it.each(cases)("%s with %s", async (run, state) => {
      const database = isolatedTestDatabase();
      const pg = testPostgres({ database: database.name, max: 1 });
      await database.create();
      try {
        if (state.drop === "history") {
          await pg`DROP SCHEMA drizzle CASCADE`;
        } else if (state.drop === "empty") {
          await pg`TRUNCATE drizzle.__drizzle_migrations`;
        } else {
          await pg`
            DELETE FROM drizzle.__drizzle_migrations WHERE created_at >= ${state.drop}
          `;
        }
        if (!state.column) {
          await pg`ALTER TABLE organizations DROP COLUMN is_test_account`;
        }
        if (state.drop === "empty" || !state.column) {
          await pg`DROP TABLE test_alunta_subscriptions`;
        }

        await pg`
          INSERT INTO "user" (id, name, email) VALUES
            ('admin-a', 'Admin A', 'a@example.test'),
            ('admin-b', 'Admin B', 'b@example.test')
        `;
        await pg`
          INSERT INTO organizations (id, name, slug) VALUES
            ('real-org', 'Real org', 'real-org'),
            ('test-org', 'Test org', 'test-org')
        `;
        await pg`
          INSERT INTO admin_activity_logs (admin_user_id, action, details, created_at)
          VALUES
            ('admin-a', 'set_test_account_flag', '{"organizationId":"real-org","testAccount":true}', '2026-01-01'),
            ('admin-b', 'set_test_account_flag', '{"organizationId":"real-org","testAccount":false}', '2026-01-02'),
            ('admin-a', 'set_test_account_flag', '{"organizationId":"test-org","testAccount":true}', '2026-01-01')
        `;
        await pg`DELETE FROM "user" WHERE id = 'admin-b'`;
        const marked = "marked" in state && state.marked;
        const cleared = "cleared" in state && state.cleared;
        if (marked) {
          // 0160 created the column at its default; only the older metadata
          // marker still says which organization is a test account.
          await pg`UPDATE organizations SET metadata = '{"testAccount":true}'::jsonb WHERE id = 'test-org'`;
          if (cleared) {
            await pg`
              INSERT INTO admin_activity_logs (admin_user_id, action, details, created_at)
              VALUES ('admin-a', 'set_test_account_flag', '{"organizationId":"test-org","testAccount":false}', '2026-02-01')
            `;
          }
        } else if (state.column) {
          // The saved flags are the truth; the audit log only looks stale.
          await pg`UPDATE organizations SET is_test_account = (id = 'test-org')`;
        }

        if (run === "versioned SQL") {
          const versioned = readMigrationFiles({
            migrationsFolder: "./drizzle",
          }).filter(({ folderMillis }) => folderMillis >= 1795000000000);
          for (const migration of versioned) {
            for (const statement of migration.sql) await pg.unsafe(statement);
          }
        } else {
          await execFileAsync("npm", ["run", run], {
            env: migrationEnv(database.name),
          });
        }

        expect(
          await pg`SELECT id, is_test_account FROM organizations ORDER BY id`,
        ).toEqual([
          // Without the column the audit log is all that is left to restore.
          { id: "real-org", is_test_account: !state.column },
          { id: "test-org", is_test_account: !cleared },
        ]);
      } finally {
        await pg.end();
        await database.drop();
      }
    });
  });
});
