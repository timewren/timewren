import { describe, expect, it } from "vitest";
import {
  EMAIL_TYPE_AUDIENCE,
  EMAIL_TYPES,
  PERSONAL_EMAIL_TYPES,
} from "./email-types";

describe("EMAIL_TYPE_AUDIENCE", () => {
  it("classifies every email type, and nothing else", () => {
    const audience: Record<string, string | undefined> = EMAIL_TYPE_AUDIENCE;
    const unclassified = EMAIL_TYPES.filter(
      (type) => audience[type] !== "personal" && audience[type] !== "business",
    );
    expect(unclassified).toEqual([]);
    expect(Object.keys(EMAIL_TYPE_AUDIENCE).sort()).toEqual(
      [...EMAIL_TYPES].sort(),
    );
    expect(new Set(EMAIL_TYPES).size).toBe(EMAIL_TYPES.length);
  });

  it("hides account mails and keeps work mails in the email activity", () => {
    for (const type of [
      "welcome",
      "drip_welcome",
      "payment_failed",
      "dunning_urgent",
      "new_login",
      "magic_link",
      "password_reset",
      "email_verification",
    ] as const) {
      expect(PERSONAL_EMAIL_TYPES).toContain(type);
    }
    for (const type of [
      "invoice",
      "timesheet_submitted",
      "absence_requested",
      "low_balance_alert",
      "portal_invitation",
      "project_budget_alert",
      "alunta_klippekort_created",
    ] as const) {
      expect(PERSONAL_EMAIL_TYPES).not.toContain(type);
    }
  });
});
