import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEMO_BLOCKED_PROCEDURES,
  isDemoBlockedAuthPath,
  isDemoBlockedProcedure,
} from "../blocked";

describe("isDemoBlockedAuthPath", () => {
  it("spærrer signup, OAuth, magic link, SMS og nulstilling", () => {
    for (const path of [
      "/sign-up/email",
      "/sign-in/social",
      "/sign-in/oauth2",
      "/sign-in/magic-link",
      "/magic-link/verify",
      "/phone-number/send-otp",
      "/sign-in/phone-number",
      "/request-password-reset",
      "/send-verification-email",
      "/organization/invite-member",
      "/organization/accept-invitation",
    ]) {
      expect(isDemoBlockedAuthPath(path), path).toBe(true);
    }
  });

  it("lader session, logout og adgangskode-login være", () => {
    for (const path of [
      "/get-session",
      "/sign-out",
      "/sign-in/email",
      "/list-sessions",
    ]) {
      expect(isDemoBlockedAuthPath(path), path).toBe(false);
    }
  });
});

describe("DEMO_BLOCKED_PROCEDURES", () => {
  it("dækker betaling, integrationer, AI, webhooks, eget domæne og API-nøgler", () => {
    for (const path of [
      "subscription.createCheckoutSession",
      "user.updateIntegrations",
      "calendar.getAuthUrl",
      "ai.parseText",
      "webhooks.create",
      "portalBranding.setCustomDomain",
      "apiKeys.create",
      "enterprise.importEmployees",
    ]) {
      expect(isDemoBlockedProcedure(path), path).toBe(true);
    }
    expect(isDemoBlockedProcedure("time.create")).toBe(false);
    expect(isDemoBlockedProcedure("clients.list")).toBe(false);
  });

  // Statisk (at importere hele appRouter tager over 30 s): routeren er
  // registreret under sit filnavn i routers/index.ts, og proceduren står
  // som "  navn:" i filen (eller i en af filerne i routerens mappe).
  it("hver spærret procedure findes i sin router (ingen stavefejl)", () => {
    const dir = join(process.cwd(), "src/lib/trpc/routers");
    const index = readFileSync(join(dir, "index.ts"), "utf8");
    const missing = [...DEMO_BLOCKED_PROCEDURES].filter((path) => {
      const [router, proc] = path.split(".");
      if (!new RegExp(`^\\s+${router}:`, "m").test(index)) return true;
      const sub = join(dir, router);
      const src = existsSync(sub)
        ? readdirSync(sub)
            .filter((f) => f.endsWith(".ts"))
            .map((f) => readFileSync(join(sub, f), "utf8"))
            .join("\n")
        : readFileSync(join(dir, `${router}.ts`), "utf8");
      return !new RegExp(`^  ${proc}:`, "m").test(src);
    });
    expect(missing).toEqual([]);
  });
});
