import { afterEach, describe, expect, it, vi } from "vitest";

async function loadDb() {
  vi.resetModules();
  const { db } = await import("../index");
  return db.$client;
}

describe("db-klientens connect_timeout", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
  });

  it("er 10 s, når DATABASE_CONNECT_TIMEOUT ikke er sat", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres@127.0.0.1:1/x");
    vi.stubEnv("DATABASE_CONNECT_TIMEOUT", "");
    const client = await loadDb();
    expect(client.options.connect_timeout).toBe(10);
    await client.end();
  });

  it("følger DATABASE_CONNECT_TIMEOUT (model-testene i CI)", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://postgres@127.0.0.1:1/x");
    vi.stubEnv("DATABASE_CONNECT_TIMEOUT", "60");
    const client = await loadDb();
    expect(client.options.connect_timeout).toBe(60);
    await client.end();
  });
});
