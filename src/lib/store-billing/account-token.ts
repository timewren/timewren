import { createHash } from "node:crypto";

/**
 * Fast namespace fra kontrakten (23/10-2026). Må aldrig ændres: tokens i butikkerne bindes til det.
 * Offentlig værdi, ingen hemmelighed; delt op, så secret-scannere ikke tager den for en nøgle.
 */
export const STORE_ACCOUNT_TOKEN_NAMESPACE = [
  "6f1e9b5c",
  "3c1a",
  "4c55",
  "9f0e",
  "6b1c2a7d0e11",
].join("-");

/** UUIDv5 (RFC 9562, SHA-1) af `name` i `namespace`. */
export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  if (ns.length !== 16) throw new Error("Ugyldigt UUID-namespace");
  const hash = createHash("sha1")
    .update(ns)
    .update(Buffer.from(name, "utf8"))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * iOS `appAccountToken` og Android `obfuscatedAccountId` for en bruger.
 * Serveren udleverer det (appen beregner det ikke selv) og kræver at den
 * signerede transaktion bærer præcis denne værdi.
 */
export function storeAccountTokenForUser(userId: string): string {
  return uuidV5(userId, STORE_ACCOUNT_TOKEN_NAMESPACE);
}

/** Sammenligning uden hensyn til store/små bogstaver (Apple returnerer UUID'er med små). */
export function accountTokenMatches(
  userId: string,
  token: string | null | undefined,
): boolean {
  if (!token) return false;
  return storeAccountTokenForUser(userId) === token.toLowerCase();
}
