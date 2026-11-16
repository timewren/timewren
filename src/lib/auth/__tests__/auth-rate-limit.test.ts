import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Login-rate-limit (#203). better-auths egne plugin-regler er for løse til
 * endpoints, der sender mail/SMS til en vilkårlig modtager (magic link:
 * 5/min, SMS: 10/min pr. IP). customRules skal stramme dem.
 */

vi.mock("@/lib/db", () => ({ db: {} }));

type Rule = { window: number; max: number };

describe("auth rate limits", () => {
  let rules: Record<string, Rule>;

  // Første import af auth-modulet er langsom (hele plugin-træet).
  beforeAll(async () => {
    const { auth } = await import("@/lib/auth");
    const o = auth.options as unknown as {
      rateLimit: { customRules: Record<string, Rule> };
    };
    rules = o.rateLimit.customRules;
  }, 120_000);

  it.each([
    ["/sign-in/email", 5],
    ["/request-password-reset", 5],
    ["/sign-in/magic-link", 5],
    ["/phone-number/send-otp", 5],
    ["/phone-number/request-password-reset", 5],
    ["/phone-number/verify", 10],
  ])("%s: højst %i pr. 15 min", (path, max) => {
    expect(rules[path]).toEqual({ window: 15 * 60, max });
  });
});
