import { describe, expect, it } from "vitest";
import { shouldAutoStartTour } from "./tour-gate";

const base = {
  onboardingCompleted: true,
  hasCompletedTour: false,
  tourServerSeen: false,
  tourActive: false,
  showOnboardingModal: false,
  demo: false,
};

describe("shouldAutoStartTour", () => {
  it("starter for owner og admin", () => {
    expect(shouldAutoStartTour({ ...base, orgRole: "owner" })).toBe(true);
    expect(shouldAutoStartTour({ ...base, orgRole: "admin" })).toBe(true);
  });

  it("starter IKKE for member, manager og hr (#426)", () => {
    expect(shouldAutoStartTour({ ...base, orgRole: "member" })).toBe(false);
    expect(shouldAutoStartTour({ ...base, orgRole: "manager" })).toBe(false);
    expect(shouldAutoStartTour({ ...base, orgRole: "hr" })).toBe(false);
  });

  it("venter på rolle-svaret — starter aldrig på gæt", () => {
    expect(shouldAutoStartTour({ ...base, orgRole: undefined })).toBe(false);
  });

  it("starter ikke hvis turen allerede er set eller fuldført", () => {
    expect(
      shouldAutoStartTour({
        ...base,
        orgRole: "owner",
        hasCompletedTour: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoStartTour({ ...base, orgRole: "owner", tourServerSeen: true }),
    ).toBe(false);
  });

  it("starter ikke mens onboarding-modal er åben eller turen kører", () => {
    expect(
      shouldAutoStartTour({ ...base, orgRole: "owner", tourActive: true }),
    ).toBe(false);
    expect(
      shouldAutoStartTour({
        ...base,
        orgRole: "owner",
        showOnboardingModal: true,
      }),
    ).toBe(false);
  });

  it("starter ikke før onboarding er gennemført", () => {
    expect(
      shouldAutoStartTour({
        ...base,
        orgRole: "owner",
        onboardingCompleted: false,
      }),
    ).toBe(false);
  });

  it("starter ikke i den offentlige demo (#1213)", () => {
    // Turen åbner over dashboardet og sender et dybt link (fx
    // /dashboard/clients) tilbage til /dashboard; demoen tilbyder den i
    // demobjælken i stedet.
    expect(shouldAutoStartTour({ ...base, orgRole: "owner", demo: true })).toBe(
      false,
    );
  });
});
