import { describe, expect, it } from "vitest";
import { legacySettingsDestination } from "./settings-legacy";

describe("legacySettingsDestination", () => {
  it("sender slettede sider til deres nye hjem", () => {
    // Slettet i 8e8e8687 (marts 2026), flyttet ind i Notifikationer/Email
    expect(legacySettingsDestination(["pwa"])).toBe(
      "/dashboard/settings/notifications#pwa",
    );
    expect(legacySettingsDestination(["email-activity"])).toBe(
      "/dashboard/settings/email?tab=aktivitet",
    );
  });

  it("forstår gængse navne på dansk og engelsk", () => {
    expect(legacySettingsDestination(["billing"])).toBe(
      "/dashboard/settings/subscription",
    );
    expect(legacySettingsDestination(["profil"])).toBe("/dashboard/settings");
    expect(legacySettingsDestination(["team"])).toBe("/dashboard/organization");
    expect(legacySettingsDestination(["rounding"])).toBe(
      "/dashboard/settings#afrunding",
    );
  });

  it("er ufølsom for store bogstaver og afsluttende led", () => {
    expect(legacySettingsDestination(["Billing", "portal"])).toBe(
      "/dashboard/settings/subscription",
    );
  });

  it("en kendt side med et ukendt underled lander på siden", () => {
    expect(legacySettingsDestination(["security", "sessions"])).toBe(
      "/dashboard/settings/security",
    );
    expect(legacySettingsDestination(["integrations", "billy"])).toBe(
      "/dashboard/settings/integrations",
    );
  });

  it("alt andet lander på indstillingsforsiden, aldrig 404", () => {
    expect(legacySettingsDestination(["findes-ikke"])).toBe(
      "/dashboard/settings",
    );
    expect(legacySettingsDestination([])).toBe("/dashboard/settings");
    expect(legacySettingsDestination(["constructor"])).toBe(
      "/dashboard/settings",
    );
  });

  it("giver kun interne stier (ingen åben videresendelse)", () => {
    for (const segs of [["//evil.com"], ["https:", "evil.com"], ["%2F%2Fx"]]) {
      expect(legacySettingsDestination(segs)).toBe("/dashboard/settings");
    }
  });
});
