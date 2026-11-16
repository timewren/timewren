import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extensionTokens } from "@/lib/db/schema";
import { verifyCalendarChannelToken } from "@/lib/integrations/calendar-webhook-token";
import { encryptSecret } from "@/lib/utils/encryption";
import {
  hashToken,
  revealToken,
  tokenLookup,
  tokenMatchesHash,
} from "../token-hash";

const KEY = "a".repeat(64);
let previousKey: string | undefined;

beforeEach(() => {
  previousKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = previousKey;
});

describe("hashToken", () => {
  it("er SHA-256 hex — samme som api_keys og Postgres' sha256()", () => {
    expect(hashToken("abc")).toBe(
      createHash("sha256").update("abc").digest("hex"),
    );
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("tokenMatchesHash", () => {
  it("matcher kun det rigtige token", () => {
    const stored = hashToken("hemmelig");
    expect(tokenMatchesHash("hemmelig", stored)).toBe(true);
    expect(tokenMatchesHash("hemmelig2", stored)).toBe(false);
  });

  it("afviser tomme og misdannede værdier", () => {
    expect(tokenMatchesHash("", hashToken(""))).toBe(false);
    expect(tokenMatchesHash("x", null)).toBe(false);
    expect(tokenMatchesHash("x", "ikke-hex")).toBe(false);
  });
});

describe("tokenLookup", () => {
  it("slår kun op på hashen — aldrig på klartekst (#726)", () => {
    const { sql, params } = new PgDialect().sqlToQuery(
      tokenLookup(extensionTokens.tokenHash, "tok"),
    );
    expect(sql).toBe('"extension_tokens"."token_hash" = $1');
    expect(params).toEqual([hashToken("tok")]);
    expect(params).not.toContain("tok");
  });
});

describe("revealToken", () => {
  it("dekrypterer den krypterede værdi", () => {
    expect(revealToken(encryptSecret("ny"))).toBe("ny");
  });

  it("returnerer null uden krypteret værdi", () => {
    expect(revealToken(null)).toBeNull();
    expect(revealToken(undefined)).toBeNull();
    expect(revealToken("")).toBeNull();
  });

  it("returnerer null frem for at kaste ved forkert nøgle", () => {
    const encrypted = encryptSecret("ny");
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    expect(revealToken(encrypted)).toBeNull();
  });
});

describe("verifyCalendarChannelToken", () => {
  it("accepterer kun tokenet der matcher hashen", () => {
    const stored = { webhookTokenHash: hashToken("kanal") };
    expect(verifyCalendarChannelToken("kanal", stored)).toBe(true);
    expect(verifyCalendarChannelToken("andet", stored)).toBe(false);
    expect(verifyCalendarChannelToken(null, stored)).toBe(false);
  });

  it("afviser alt for kanaler uden hash — ingen CRON_SECRET-fallback", () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "cron";
    try {
      const stored = { webhookTokenHash: null };
      expect(verifyCalendarChannelToken("cron", stored)).toBe(false);
      expect(verifyCalendarChannelToken("kanal", stored)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previous;
    }
  });
});
