/**
 * AES-256-GCM Encryption for API Keys
 *
 * Encrypts sensitive data like API keys before storing in database.
 * Uses a 32-byte encryption key from environment variable.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const _AUTH_TAG_LENGTH = 16;

/**
 * Development fallback key - generated once per process
 * SECURITY: This is only used in development. In production, ENCRYPTION_KEY must be set.
 */
let _devFallbackKey: Buffer | null = null;

function getDevFallbackKey(): Buffer {
  if (!_devFallbackKey) {
    // Generate a random key for this development session
    _devFallbackKey = randomBytes(32);
    console.warn(
      "\n⚠️  ENCRYPTION_KEY not set. Using random development key.\n" +
        "   Data encrypted in this session won't be readable in other sessions.\n" +
        "   To fix: Add ENCRYPTION_KEY to your .env.local file:\n" +
        `   ENCRYPTION_KEY=${_devFallbackKey.toString("hex")}\n`,
    );
  }
  return _devFallbackKey;
}

/**
 * Get encryption key from environment
 * Must be 32 bytes (256 bits) for AES-256
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    // In development, generate a random key per session
    if (process.env.NODE_ENV === "development") {
      return getDevFallbackKey();
    }
    throw new Error(
      "ENCRYPTION_KEY environment variable is required for production. " +
        "Generate with: openssl rand -hex 32",
    );
  }

  // Key should be 64 hex characters (32 bytes)
  if (key.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be 64 hex characters (32 bytes for AES-256). " +
        "Generate with: openssl rand -hex 32",
    );
  }

  return Buffer.from(key, "hex");
}

/**
 * Encrypt a string value
 * Returns base64 encoded string: iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return "";
  }

  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag();

  // Combine iv:authTag:ciphertext
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

/**
 * Decrypt an encrypted string
 * Expects format: iv:authTag:ciphertext (base64 encoded)
 */
export function decrypt(encryptedValue: string): string {
  if (!encryptedValue) {
    return "";
  }

  // Værdier fra encryptSecret har et entydigt præfiks og dekrypteres strengt
  // (fejl kastes i stedet for at returnere ciphertext som "nøgle").
  if (encryptedValue.startsWith(SECRET_PREFIX)) {
    return decryptSecret(encryptedValue);
  }

  // Check if value is encrypted (contains our separator pattern)
  if (!encryptedValue.includes(":")) {
    // Return as-is for backwards compatibility with unencrypted values
    return encryptedValue;
  }

  const parts = encryptedValue.split(":");
  if (parts.length !== 3) {
    // Not in expected format, return as-is
    return encryptedValue;
  }

  try {
    const key = getEncryptionKey();
    const [ivBase64, authTagBase64, ciphertext] = parts;

    const iv = Buffer.from(ivBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    // If decryption fails, the value might not be encrypted
    // Return as-is for backwards compatibility
    console.warn("Decryption failed, returning original value:", error);
    return encryptedValue;
  }
}

/**
 * Check if a value appears to be encrypted
 */
export function isEncrypted(value: string): boolean {
  if (!value) return false;
  if (value.startsWith(SECRET_PREFIX)) return true;

  const parts = value.split(":");
  if (parts.length !== 3) return false;

  // Check if parts look like base64
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  return parts.every((part) => base64Regex.test(part));
}

/**
 * Mask an API key for display (show first 4 and last 4 chars)
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 12) {
    return "••••••••";
  }

  // If encrypted, don't try to mask
  if (isEncrypted(key)) {
    return "••••••••";
  }

  const first = key.slice(0, 4);
  const last = key.slice(-4);
  return `${first}••••${last}`;
}

// ---------------------------------------------------------------------------
// Integrations-tokens og -secrets (#690)
//
// encryptSecret/decryptSecret bruger samme AES-256-GCM-nøgle (ENCRYPTION_KEY),
// men er strenge:
// - Værdien får et entydigt, versioneret præfiks ("enc:v1:"), så læsning aldrig
//   skal gætte på om en række er krypteret.
// - Ingen udviklings-fallback-nøgle og ingen klartekst-fallback: mangler eller
//   er nøglen ugyldig, kastes en tydelig fejl, og intet skrives.
// - Dekrypteringsfejl kastes i stedet for at returnere ciphertext.
// ---------------------------------------------------------------------------

/** Entydigt præfiks for værdier krypteret med encryptSecret. */
export const SECRET_PREFIX = "enc:v1:";

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

function getStrictEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new EncryptionKeyError(
      "ENCRYPTION_KEY mangler: integrations-tokens kan ikke krypteres eller dekrypteres. " +
        "Sæt en 64-tegns hex-nøgle (openssl rand -hex 32). Tokens gemmes aldrig i klartekst.",
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new EncryptionKeyError(
      "ENCRYPTION_KEY er ugyldig: den skal være 64 hex-tegn (32 bytes til AES-256).",
    );
  }
  return Buffer.from(key, "hex");
}

function aesGcmDecrypt(payload: string, key: Buffer): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Krypteret værdi har ugyldigt format");
  }
  const [ivBase64, authTagBase64, ciphertext] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivBase64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  let decrypted = decipher.update(ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export type SecretFormat = "prefixed" | "legacy" | "plaintext";

/**
 * Hvordan en gemt værdi er lagret:
 * - "prefixed": encryptSecret (enc:v1:iv:authTag:ciphertext)
 * - "legacy": ældre encrypt() uden præfiks (iv:authTag:ciphertext, base64)
 * - "plaintext": alt andet — klartekst fra før kryptering blev indført
 */
export function detectSecretFormat(stored: string): SecretFormat {
  if (stored.startsWith(SECRET_PREFIX)) return "prefixed";
  if (isEncrypted(stored)) return "legacy";
  return "plaintext";
}

/** Kryptér en token/secret til lagring. Kaster ved manglende nøgle. */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptSecret: tom værdi kan ikke krypteres");
  }
  if (plaintext.startsWith(SECRET_PREFIX)) {
    // Dobbeltkryptering er altid en kodefejl (en allerede gemt værdi sendt
    // tilbage ind) — fang den i stedet for at gemme ulæselige tokens.
    throw new Error("encryptSecret: værdien er allerede krypteret");
  }
  const key = getStrictEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

/** Som encryptSecret, men null/undefined/"" bliver til null. */
export function encryptSecretOrNull(
  plaintext: string | null | undefined,
): string | null {
  return plaintext ? encryptSecret(plaintext) : null;
}

/**
 * Læs en gemt token/secret. Tåler både nye (præfiks), ældre krypterede og
 * klartekst-rækker fra før backfill. Kaster hvis en krypteret værdi ikke kan
 * dekrypteres (fx forkert nøgle) — returnerer aldrig ciphertext som token.
 */
export function decryptSecret(stored: string): string {
  const format = detectSecretFormat(stored);
  if (format === "plaintext") return stored;
  const key = getStrictEncryptionKey();
  const payload =
    format === "prefixed" ? stored.slice(SECRET_PREFIX.length) : stored;
  try {
    return aesGcmDecrypt(payload, key);
  } catch (error) {
    throw new Error(
      "Krypteret token kunne ikke dekrypteres — er ENCRYPTION_KEY ændret?",
      { cause: error },
    );
  }
}

/** Som decryptSecret, men null/undefined/"" bliver til null. */
export function decryptSecretOrNull(
  stored: string | null | undefined,
): string | null {
  return stored ? decryptSecret(stored) : null;
}
