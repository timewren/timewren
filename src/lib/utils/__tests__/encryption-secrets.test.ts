import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decrypt,
  decryptSecret,
  decryptSecretOrNull,
  detectSecretFormat,
  EncryptionKeyError,
  encrypt,
  encryptSecret,
  encryptSecretOrNull,
  isEncrypted,
  SECRET_PREFIX,
} from "../encryption";

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);
const GOOGLE_ACCESS = "ya29.a0AfB_byC-example_token.with-dots";
const GOOGLE_REFRESH = "1//0gExampleRefresh-Token_xyz";

const originalKey = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  process.env.ENCRYPTION_KEY = originalKey;
});

describe("encryptSecret / decryptSecret", () => {
  it("round-tripper og bruger det entydige præfiks", () => {
    const stored = encryptSecret(GOOGLE_ACCESS);
    expect(stored.startsWith(SECRET_PREFIX)).toBe(true);
    expect(stored).not.toContain(GOOGLE_ACCESS);
    expect(decryptSecret(stored)).toBe(GOOGLE_ACCESS);
  });

  it("giver forskellig ciphertext for samme værdi (tilfældig IV)", () => {
    expect(encryptSecret(GOOGLE_REFRESH)).not.toBe(
      encryptSecret(GOOGLE_REFRESH),
    );
  });

  it("round-tripper unicode og JSON", () => {
    const json = JSON.stringify({ apiKey: "nøgle:æøå:123" });
    expect(decryptSecret(encryptSecret(json))).toBe(json);
  });

  it("afviser dobbeltkryptering", () => {
    expect(() => encryptSecret(encryptSecret("x"))).toThrow(/allerede/);
  });

  it("afviser tom værdi, men OrNull-varianterne mapper tomt til null", () => {
    expect(() => encryptSecret("")).toThrow();
    expect(encryptSecretOrNull(null)).toBeNull();
    expect(encryptSecretOrNull(undefined)).toBeNull();
    expect(encryptSecretOrNull("")).toBeNull();
    expect(decryptSecretOrNull(null)).toBeNull();
  });
});

describe("blandede gamle og nye rækker", () => {
  it("læser klartekst, ældre krypterede og nye krypterede værdier", () => {
    const rows = [
      GOOGLE_ACCESS, // klartekst fra før #690
      encrypt(GOOGLE_REFRESH), // ældre format uden præfiks
      encryptSecret("billy-key-123"), // nyt format
    ];
    expect(rows.map(detectSecretFormat)).toEqual([
      "plaintext",
      "legacy",
      "prefixed",
    ]);
    expect(rows.map(decryptSecret)).toEqual([
      GOOGLE_ACCESS,
      GOOGLE_REFRESH,
      "billy-key-123",
    ]);
  });

  it("legacy decrypt() forstår også det nye format", () => {
    const stored = encryptSecret("imap-password");
    expect(decrypt(stored)).toBe("imap-password");
    expect(isEncrypted(stored)).toBe(true);
  });

  it("Google-tokens forveksles aldrig med krypterede værdier", () => {
    expect(detectSecretFormat(GOOGLE_ACCESS)).toBe("plaintext");
    expect(detectSecretFormat(GOOGLE_REFRESH)).toBe("plaintext");
  });

  it("kaster ved forkert nøgle i stedet for at returnere ciphertext", () => {
    const stored = encryptSecret(GOOGLE_ACCESS);
    process.env.ENCRYPTION_KEY = OTHER_KEY;
    expect(() => decryptSecret(stored)).toThrow(/dekrypteres/);
    expect(() => decrypt(stored)).toThrow(/dekrypteres/);
  });
});

describe("manglende eller ugyldig nøgle", () => {
  it("encryptSecret kaster EncryptionKeyError uden ENCRYPTION_KEY — også i development", () => {
    delete process.env.ENCRYPTION_KEY;
    const env = process.env as Record<string, string | undefined>;
    const originalNodeEnv = env.NODE_ENV;
    env.NODE_ENV = "development";
    try {
      expect(() => encryptSecret(GOOGLE_ACCESS)).toThrow(EncryptionKeyError);
      expect(() => encryptSecretOrNull(GOOGLE_ACCESS)).toThrow(
        /ENCRYPTION_KEY mangler/,
      );
    } finally {
      env.NODE_ENV = originalNodeEnv;
    }
  });

  it("decryptSecret kaster for krypterede værdier uden nøgle", () => {
    const stored = encryptSecret(GOOGLE_ACCESS);
    delete process.env.ENCRYPTION_KEY;
    expect(() => decryptSecret(stored)).toThrow(EncryptionKeyError);
  });

  it("klartekst kan stadig læses uden nøgle (overgang før backfill)", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(decryptSecret(GOOGLE_ACCESS)).toBe(GOOGLE_ACCESS);
  });

  it("afviser en nøgle der ikke er 64 hex-tegn", () => {
    process.env.ENCRYPTION_KEY = "z".repeat(64);
    expect(() => encryptSecret("x")).toThrow(EncryptionKeyError);
  });
});
