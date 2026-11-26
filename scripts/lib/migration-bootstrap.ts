import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type Database = PostgresJsDatabase<Record<string, never>>;

const migrationConfig = { migrationsFolder: "./drizzle" };

const bootstrapThrough = 1795000000000;
const legacyBaselineThrough = 1794900000000;
const testAccountRestoreThrough = 1795100000000;

async function recordMigrationHistory(
  db: Pick<Database, "execute">,
  through: number,
  migrationFiles = readMigrationFiles(migrationConfig),
) {
  const migrations = migrationFiles.filter(
    (migration) => migration.folderMillis <= through,
  );
  if (!migrations.some((migration) => migration.folderMillis === through)) {
    throw new Error(`Migration journal is missing the cutoff ${through}`);
  }

  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
  const [entry] = await db.execute(sql`
    SELECT id FROM drizzle.__drizzle_migrations LIMIT 1
  `);
  if (entry) {
    throw new Error("Migration tracking already contains entries");
  }

  await db.execute(sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
    ${sql.join(
      migrations.map(
        ({ hash, folderMillis }) => sql`(${hash}, ${folderMillis})`,
      ),
      sql`, `,
    )}
  `);
}

export async function migrateDatabase(db: Database) {
  const migrations = readMigrationFiles(migrationConfig);
  const dialect = new PgDialect();
  // The dialect's migrator types its session without the relational schema.
  const session = db._.session as Parameters<PgDialect["migrate"]>[1];
  await dialect.migrate(migrations, session, migrationConfig);
}

export async function baselineUntrackedDatabase(db: Database) {
  return db.transaction(async (tx) => {
    // Every statement is idempotent, and 0160 replays the audit log only when
    // it has to create the flag column, so saved flags survive a replay.
    const migrations = readMigrationFiles(migrationConfig);
    let applied = 0;
    for (const migration of migrations) {
      if (
        migration.folderMillis > legacyBaselineThrough &&
        migration.folderMillis <= testAccountRestoreThrough &&
        migration.sql.length > 0
      ) {
        for (const statement of migration.sql) {
          await tx.execute(sql.raw(statement));
        }
        applied++;
      }
    }
    await recordMigrationHistory(tx, testAccountRestoreThrough, migrations);
    return applied;
  });
}

/** Install the frozen SQL checkpoint and its tracking records atomically. */
export async function bootstrapEmptyDatabase(db: Database): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [table] = await tx.execute(sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' LIMIT 1
    `);
    if (table) return false;

    const schema = readFileSync("./drizzle/bootstrap/0160_schema.sql", "utf8");
    for (const statement of schema.split("--> statement-breakpoint")) {
      await tx.execute(sql.raw(statement));
    }
    await recordMigrationHistory(tx, bootstrapThrough);
    return true;
  });
}
