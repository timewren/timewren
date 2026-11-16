import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetValkeyForTests, getValkey } from "@/lib/valkey";

describe("getValkey", () => {
  const original = process.env.VALKEY_URL;

  beforeEach(() => {
    __resetValkeyForTests();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.VALKEY_URL;
    } else {
      process.env.VALKEY_URL = original;
    }
    __resetValkeyForTests();
  });

  it("returns null when VALKEY_URL is unset", () => {
    delete process.env.VALKEY_URL;
    expect(getValkey()).toBeNull();
  });

  it("memoizes the null result without re-reading env", () => {
    delete process.env.VALKEY_URL;
    expect(getValkey()).toBeNull();
    process.env.VALKEY_URL = "redis://localhost:6379";
    // Still null because the first call memoized before env changed.
    expect(getValkey()).toBeNull();
  });
});
