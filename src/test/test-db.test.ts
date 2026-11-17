import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import { connectTestDb, testPostgres } from "./test-db";

function connectTimeout() {
  return Object.assign(new Error("write CONNECT_TIMEOUT localhost:5432"), {
    code: "CONNECT_TIMEOUT",
  });
}

/** Falsk `sql`-tag, der giver svarene i rækkefølge (Error = afvis). */
function fakeSql(...answers: unknown[]) {
  const sql = vi.fn(async () => {
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return sql as unknown as postgres.Sql & typeof sql;
}

describe("testPostgres", () => {
  it("giver forbindelsen 60 s til at komme op på en presset runner", async () => {
    const sql = testPostgres({ max: 1 });
    expect(sql.options.connect_timeout).toBe(60);
    expect(sql.options.max).toBe(1);
    await sql.end();
  });

  it("lader filen selv vælge en anden connect_timeout", async () => {
    const sql = testPostgres({ connect_timeout: 5 });
    expect(sql.options.connect_timeout).toBe(5);
    await sql.end();
  });
});

describe("connectTestDb", () => {
  it("prøver én gang til efter CONNECT_TIMEOUT", async () => {
    const admin = fakeSql(connectTimeout(), [{ "?column?": 1 }]);
    const client = fakeSql([{ "?column?": 1 }]);

    await connectTestDb(admin, client);

    expect(admin).toHaveBeenCalledTimes(2);
    expect(client).toHaveBeenCalledTimes(1);
  });

  it("giver op efter anden CONNECT_TIMEOUT", async () => {
    const admin = fakeSql(connectTimeout(), connectTimeout());

    await expect(connectTestDb(admin)).rejects.toMatchObject({
      code: "CONNECT_TIMEOUT",
    });
    expect(admin).toHaveBeenCalledTimes(2);
  });

  it("prøver ikke igen ved andre fejl", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    const admin = fakeSql(refused, [{ "?column?": 1 }]);

    await expect(connectTestDb(admin)).rejects.toBe(refused);
    expect(admin).toHaveBeenCalledTimes(1);
  });
});

describe("integrationstests forbinder via test-db", () => {
  function integrationFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return integrationFiles(path);
      return entry.name.endsWith(".integration.test.ts") ? [path] : [];
    });
  }

  it("ingen fil åbner TEST_DATABASE_URL med postgres() direkte", () => {
    const src = join(__dirname, "..");
    const direct = integrationFiles(src)
      .filter((file) =>
        /postgres\(\s*TEST_DATABASE_URL/.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(src, file));

    expect(direct).toEqual([]);
  });

  // Oprydning i den delte database (kontosletning pr. testbruger) var det
  // tungeste i suiten og løb over hookTimeout på en presset runner. Hver fil
  // skriver derfor i sit eget schema eller sin egen database. Dette er kun
  // konventionen i teksten; at intet faktisk skrives i public, tjekker
  // integration-db-setup.ts efter kørslen.
  it("hver fil laver sit eget schema eller sin egen database", () => {
    const src = join(__dirname, "..");
    const shared = integrationFiles(src)
      .filter(
        (file) =>
          !/CREATE SCHEMA|isolatedTestDatabase\(/.test(
            readFileSync(file, "utf8"),
          ),
      )
      .map((file) => relative(src, file));

    expect(shared).toEqual([]);
  });
});
