/**
 * Hashing af bearer-/link-tokens (#713).
 *
 * Samme mønster som api_keys: tokens er højentropi-tilfældige værdier, så
 * SHA-256 (uden salt/stretching) er tilstrækkeligt — opslag sker på hashen,
 * og en DB-lækage giver ikke længere direkte adgang.
 *
 * Klartekst gemmes ikke længere: backfill udfyldte *_hash for ældre rækker,
 * og migration 0126 nulstillede klartekst-kolonnerne (#726). Opslag sker
 * udelukkende på hashen.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { decryptSecret } from "@/lib/utils/encryption";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** SHA-256 (hex) af et token — det der gemmes i *_hash-kolonnerne. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Konstant-tids-sammenligning af et præsenteret token mod en gemt hash. */
export function tokenMatchesHash(
  token: string,
  storedHash: string | null | undefined,
): boolean {
  if (!token || !storedHash || !SHA256_HEX.test(storedHash)) return false;
  return timingSafeEqual(
    Buffer.from(hashToken(token), "hex"),
    Buffer.from(storedHash, "hex"),
  );
}

/** WHERE-betingelse for opslag af et token: kun hash-match. */
export function tokenLookup(hashColumn: AnyPgColumn, token: string): SQL {
  return eq(hashColumn, hashToken(token));
}

/**
 * Læs et token der skal kunne vises igen (delingslinks o.l.) fra den
 * krypterede kolonne. Mangler den, eller kan værdien ikke dekrypteres (fx
 * skiftet ENCRYPTION_KEY), returneres null frem for at vælte hele
 * visningen — brugeren kan generere et nyt link.
 */
export function revealToken(
  encrypted: string | null | undefined,
): string | null {
  if (!encrypted) return null;
  try {
    return decryptSecret(encrypted);
  } catch (error) {
    console.error("[token-hash] kunne ikke dekryptere token", error);
    return null;
  }
}
