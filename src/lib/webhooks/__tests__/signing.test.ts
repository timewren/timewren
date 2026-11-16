import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret } from "@/lib/utils/encryption";
import { maskWebhookSecret, signWebhookPayload } from "../signing";

const SECRET = `whsec_${"ab".repeat(32)}`;
const PAYLOAD = JSON.stringify({ event: "time_entry.created", data: { a: 1 } });
const expected = crypto
  .createHmac("sha256", SECRET)
  .update(PAYLOAD)
  .digest("hex");

const originalKey = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
});

afterEach(() => {
  process.env.ENCRYPTION_KEY = originalKey;
});

describe("webhook-signering med krypteret secret (#712)", () => {
  it("signerer med den dekrypterede secret for nye (krypterede) rækker", () => {
    expect(signWebhookPayload(PAYLOAD, encryptSecret(SECRET))).toBe(expected);
  });

  it("signerer uændret for gamle klartekst-rækker", () => {
    expect(signWebhookPayload(PAYLOAD, SECRET)).toBe(expected);
  });

  it("kaster i stedet for at signere med ciphertext ved forkert nøgle", () => {
    const stored = encryptSecret(SECRET);
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    expect(() => signWebhookPayload(PAYLOAD, stored)).toThrow();
  });

  it("maskerer den rigtige secret, ikke ciphertext", () => {
    const masked = `${SECRET.substring(0, 10)}...${SECRET.substring(SECRET.length - 4)}`;
    expect(maskWebhookSecret(encryptSecret(SECRET))).toBe(masked);
    expect(maskWebhookSecret(SECRET)).toBe(masked);
  });

  it("viser kun prikker hvis secret ikke kan dekrypteres", () => {
    const stored = encryptSecret(SECRET);
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    expect(maskWebhookSecret(stored)).toBe("••••••••");
  });
});
