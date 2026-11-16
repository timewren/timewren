import { describe, expect, it } from "vitest";
import {
  type ActivationDripInput,
  activationNudge,
  isPrimaryUse,
  isWithinDripSendWindow,
  pickActivationDrip,
  shouldSendKlippekortTips,
  welcomeCardState,
} from "./activation";

const noFacts = {
  hasClient: false,
  hasTimeEntry: false,
  hasKlippekort: false,
  hasInvoice: false,
};

const allOn = {
  showInvoicing: true,
  showKlippekort: true,
  showClients: true,
  canManageTeam: true,
};

describe("activationNudge", () => {
  it("viser intet uden svar eller ved 'time'", () => {
    expect(
      activationNudge({ primaryUse: null, facts: noFacts, ...allOn }),
    ).toBeNull();
    expect(
      activationNudge({ primaryUse: "time", facts: noFacts, ...allOn }),
    ).toBeNull();
  });

  it("faktura først når der er tid og ingen faktura", () => {
    expect(
      activationNudge({ primaryUse: "invoicing", facts: noFacts, ...allOn }),
    ).toBeNull();
    expect(
      activationNudge({
        primaryUse: "invoicing",
        facts: { ...noFacts, hasTimeEntry: true },
        ...allOn,
      })?.key,
    ).toBe("first-invoice");
    expect(
      activationNudge({
        primaryUse: "invoicing",
        facts: { ...noFacts, hasTimeEntry: true },
        ...allOn,
        showInvoicing: false,
      }),
    ).toBeNull();
  });

  it("klippekort: kunde før klippekort, og intet på planer uden klippekort", () => {
    expect(
      activationNudge({ primaryUse: "klippekort", facts: noFacts, ...allOn })
        ?.key,
    ).toBe("first-client");
    expect(
      activationNudge({
        primaryUse: "klippekort",
        facts: { ...noFacts, hasClient: true },
        ...allOn,
      })?.key,
    ).toBe("first-klippekort");
    expect(
      activationNudge({
        primaryUse: "klippekort",
        facts: { ...noFacts, hasClient: true },
        ...allOn,
        showKlippekort: false,
      }),
    ).toBeNull();
  });

  it("team kun for ejere/admins", () => {
    expect(
      activationNudge({
        primaryUse: "team",
        facts: noFacts,
        ...allOn,
        canManageTeam: false,
      }),
    ).toBeNull();
    expect(
      activationNudge({ primaryUse: "team", facts: noFacts, ...allOn })?.key,
    ).toBe("invite-team");
    expect(
      activationNudge({
        primaryUse: "team",
        facts: { ...noFacts, hasTeammates: true },
        ...allOn,
      }),
    ).toBeNull();
  });

  it("isPrimaryUse afviser ukendte værdier", () => {
    expect(isPrimaryUse("team")).toBe(true);
    expect(isPrimaryUse("andet")).toBe(false);
    expect(isPrimaryUse(null)).toBe(false);
  });
});

const base: ActivationDripInput = {
  signupAt: new Date("2026-10-10T10:00:00Z"),
  hoursSinceSignup: 0,
  daysSinceFirstEntry: null,
  hasClient: false,
  hasKlippekort: false,
  hasInvoice: false,
  unbilledHours: 0,
  canManageBilling: true,
  sent: new Set(),
};

describe("pickActivationDrip", () => {
  it("ingen tidspost: først efter 48 timer, og kun én gang", () => {
    expect(pickActivationDrip({ ...base, hoursSinceSignup: 47 })).toBeNull();
    expect(pickActivationDrip({ ...base, hoursSinceSignup: 48 })).toBe(
      "drip_no_time_48h",
    );
    expect(
      pickActivationDrip({
        ...base,
        hoursSinceSignup: 72,
        sent: new Set(["drip_no_time_48h"]),
      }),
    ).toBeNull();
  });

  it("konti fra før release får ingen aktiveringsmails", () => {
    expect(
      pickActivationDrip({
        ...base,
        signupAt: new Date("2026-10-01T10:00:00Z"),
        hoursSinceSignup: 72,
      }),
    ).toBeNull();
  });

  it("gamle konti får ingen aktiveringsmails", () => {
    expect(
      pickActivationDrip({ ...base, hoursSinceSignup: 46 * 24 }),
    ).toBeNull();
  });

  it("tid uden faktura: kun fakturaplaner, efter 14 dage og med ufaktureret tid", () => {
    const withTime = {
      ...base,
      hoursSinceSignup: 20 * 24,
      daysSinceFirstEntry: 14,
      unbilledHours: 3,
    };
    expect(pickActivationDrip(withTime)).toBe("drip_time_no_invoice");
    expect(
      pickActivationDrip({ ...withTime, daysSinceFirstEntry: 13 }),
    ).toBeNull();
    expect(
      pickActivationDrip({ ...withTime, canManageBilling: false }),
    ).toBeNull();
    expect(pickActivationDrip({ ...withTime, hasInvoice: true })).toBeNull();
    expect(pickActivationDrip({ ...withTime, unbilledHours: 0.5 })).toBeNull();
  });

  it("kunde uden klippekort: ikke hvis klippekort-tips er sendt", () => {
    const withClient = {
      ...base,
      hoursSinceSignup: 8 * 24,
      daysSinceFirstEntry: 2,
      hasClient: true,
    };
    expect(pickActivationDrip(withClient)).toBe("drip_client_no_klippekort");
    expect(
      pickActivationDrip({ ...withClient, canManageBilling: false }),
    ).toBeNull();
    expect(
      pickActivationDrip({ ...withClient, hasKlippekort: true }),
    ).toBeNull();
    expect(
      pickActivationDrip({
        ...withClient,
        sent: new Set(["drip_klippekort_tips"]),
      }),
    ).toBeNull();
    expect(
      pickActivationDrip({ ...withClient, hoursSinceSignup: 6 * 24 }),
    ).toBeNull();
  });
});

describe("isWithinDripSendWindow", () => {
  it("sender ikke om natten (dansk tid)", () => {
    // 2026-10-02 er sommertid: UTC+2
    expect(isWithinDripSendWindow(new Date("2026-10-02T01:00:00Z"))).toBe(
      false,
    );
    expect(isWithinDripSendWindow(new Date("2026-10-02T05:59:00Z"))).toBe(
      false,
    );
    expect(isWithinDripSendWindow(new Date("2026-10-02T06:00:00Z"))).toBe(true);
    expect(isWithinDripSendWindow(new Date("2026-10-02T17:59:00Z"))).toBe(true);
    expect(isWithinDripSendWindow(new Date("2026-10-02T18:00:00Z"))).toBe(
      false,
    );
  });
});

describe("welcomeCardState", () => {
  const w = {
    hasTimeEntry: false,
    primaryUse: null,
    dismissed: false,
    accountAgeDays: 0,
  };

  it("ny bruger uden tid: timer og spørgsmål", () => {
    expect(welcomeCardState(w)).toEqual({
      visible: true,
      showFirstTimer: true,
      showSurvey: true,
    });
  });

  it("lukket kort vises aldrig igen", () => {
    expect(welcomeCardState({ ...w, dismissed: true }).visible).toBe(false);
  });

  it("gammel konto uden tid får timer-delen og spørgsmålet", () => {
    expect(welcomeCardState({ ...w, accountAgeDays: 200 })).toEqual({
      visible: true,
      showFirstTimer: true,
      showSurvey: true,
    });
  });

  it("gammel aktiv konto uden svar: intet kort", () => {
    expect(
      welcomeCardState({ ...w, hasTimeEntry: true, accountAgeDays: 200 })
        .visible,
    ).toBe(false);
  });

  it("ny konto med tid men uden svar: kun spørgsmålet", () => {
    expect(welcomeCardState({ ...w, hasTimeEntry: true })).toEqual({
      visible: true,
      showFirstTimer: false,
      showSurvey: true,
    });
  });

  it("besvaret og med tid: intet kort", () => {
    expect(
      welcomeCardState({ ...w, hasTimeEntry: true, primaryUse: "time" })
        .visible,
    ).toBe(false);
  });
});

describe("shouldSendKlippekortTips", () => {
  const base = {
    canManageBilling: true,
    daysSinceSignup: 31,
    isActive: true,
    sent: new Set<string>(),
  };
  it("sendes efter 30 dage (alle planer, også Gratis og Privat)", () => {
    expect(shouldSendKlippekortTips(base)).toBe(true);
  });
  it("sendes ikke til brugere, der ikke kan oprette klippekort (ikke ejer/admin)", () => {
    expect(shouldSendKlippekortTips({ ...base, canManageBilling: false })).toBe(
      false,
    );
  });
  it("sendes ikke før dag 30, til inaktive eller to gange", () => {
    expect(shouldSendKlippekortTips({ ...base, daysSinceSignup: 29 })).toBe(
      false,
    );
    expect(shouldSendKlippekortTips({ ...base, isActive: false })).toBe(false);
    expect(
      shouldSendKlippekortTips({
        ...base,
        sent: new Set(["drip_klippekort_tips"]),
      }),
    ).toBe(false);
    expect(
      shouldSendKlippekortTips({
        ...base,
        sent: new Set(["drip_client_no_klippekort"]),
      }),
    ).toBe(false);
  });
});
