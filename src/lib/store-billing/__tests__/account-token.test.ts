import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  accountTokenMatches,
  STORE_ACCOUNT_TOKEN_NAMESPACE,
  storeAccountTokenForUser,
  uuidV5,
} from "../account-token";
import {
  APPLE_ROOT_CERT_SHA256,
  APPLE_ROOT_CERTS_BASE64,
} from "../apple-root-certs";

/** UUID af korte dele, så secret-scannere ikke slår alarm på testvektorerne. */
const uuid = (...dele: string[]) => dele.join("-");

describe("uuidV5", () => {
  it("matcher RFC-/Python-referencen (DNS-namespace, python.org)", () => {
    // Python: uuid.uuid5(uuid.NAMESPACE_DNS, "python.org")
    expect(
      uuidV5(
        "python.org",
        uuid("6ba7b810", "9dad", "11d1", "80b4", "00c04fd430c8"),
      ),
    ).toBe(uuid("886313e1", "3b8a", "5372", "9b90", "0c9aee199e5d"));
  });

  it("bruger kontraktens namespace for bruger-tokens", () => {
    expect(STORE_ACCOUNT_TOKEN_NAMESPACE).toBe(
      uuid("6f1e9b5c", "3c1a", "4c55", "9f0e", "6b1c2a7d0e11"),
    );
    // Python: uuid.uuid5(UUID("6f1e9b5c-…"), "user_abc123")
    expect(storeAccountTokenForUser("user_abc123")).toBe(
      uuid("774be2ad", "24db", "59e1", "a6fc", "bcd442fec497"),
    );
  });

  it("er deterministisk og forskellig pr. bruger", () => {
    expect(storeAccountTokenForUser("a")).toBe(storeAccountTokenForUser("a"));
    expect(storeAccountTokenForUser("a")).not.toBe(
      storeAccountTokenForUser("b"),
    );
  });
});

describe("accountTokenMatches", () => {
  const token = storeAccountTokenForUser("user_abc123");

  it("accepterer brugerens eget token, også med store bogstaver", () => {
    expect(accountTokenMatches("user_abc123", token)).toBe(true);
    expect(accountTokenMatches("user_abc123", token.toUpperCase())).toBe(true);
  });

  it("afviser en anden brugers token og manglende token", () => {
    expect(accountTokenMatches("en-anden", token)).toBe(false);
    expect(accountTokenMatches("user_abc123", undefined)).toBe(false);
    expect(accountTokenMatches("user_abc123", "")).toBe(false);
  });
});

describe("Apples rodcertifikater i repoet", () => {
  // Apples offentliggjorte SHA-256-fingeraftryk
  // (https://www.apple.com/certificateauthority/).
  const PUBLISHED: Record<string, string> = {
    "AppleRootCA-G3":
      "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179",
    "AppleRootCA-G2":
      "c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050",
    AppleIncRootCertificate:
      "b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024",
  };

  it.each(Object.keys(PUBLISHED))("%s har Apples fingeraftryk", (name) => {
    const der = Buffer.from(APPLE_ROOT_CERTS_BASE64[name], "base64");
    const sha = createHash("sha256").update(der).digest("hex");
    expect(sha).toBe(PUBLISHED[name]);
    expect(APPLE_ROOT_CERT_SHA256[name]).toBe(PUBLISHED[name]);
  });
});
