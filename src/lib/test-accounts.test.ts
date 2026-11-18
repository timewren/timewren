import { describe, expect, it } from "vitest";
import { isTestAccountEmail } from "./test-accounts";

describe("isTestAccountEmail", () => {
  it.each([
    "account+e2e@company.dk",
    "account+SMOKE-42@company.dk",
    "account+roeg_42@company.dk",
    "account@example.com",
    "account@example.org",
    "account@mx.example.invalid",
    "test@company.dk",
    "test+42@company.dk",
    "e2e-123-abc@example.dk",
    "owner@acme-studio.demo",
    "demo@timetrack.dk",
  ])("recognizes test address %s", (email) => {
    expect(isTestAccountEmail(email)).toBe(true);
  });

  it.each([
    "account+kunde@company.dk",
    "account+smoketestcustomer@company.dk",
    "testperson@company.dk",
    "account@example.com.dk",
    "account@invalid.dk",
    "account@demo.dk",
    "demo@company.dk",
    "kunde.demo@timetrack.dk",
  ])("preserves customer address %s", (email) => {
    expect(isTestAccountEmail(email)).toBe(false);
  });
});
