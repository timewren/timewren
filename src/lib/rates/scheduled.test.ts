import { describe, expect, it } from "vitest";
import {
  copenhagenToday,
  indexScheduledChanges,
  resolveRateAtDate,
  type ScheduledRateChangeLite,
  toRateDateKey,
} from "./scheduled";

const CLIENT = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";

let seq = 0;
function change(
  overrides: Partial<ScheduledRateChangeLite> = {},
): ScheduledRateChangeLite {
  seq++;
  return {
    id: `change-${seq}`,
    clientId: CLIENT,
    projectId: null,
    newRate: "800.00",
    oldRate: null,
    effectiveDate: "2026-11-01",
    appliedAt: null,
    cancelledAt: null,
    createdAt: new Date(Date.UTC(2026, 8, 1, 10, 0, seq)),
    ...overrides,
  };
}

describe("resolveRateAtDate — Kunde A 600 → 800 pr. 1. november", () => {
  describe("a. planlagt (ikke anvendt) ændring", () => {
    const planned = [change()];

    it("giver den nye sats på selve ikrafttrædelsesdatoen", () => {
      expect(resolveRateAtDate(planned, "600.00", "2026-11-01")).toBe("800.00");
    });

    it("giver den nye sats efter datoen", () => {
      expect(resolveRateAtDate(planned, "600.00", "2026-12-15")).toBe("800.00");
    });

    it("giver den nuværende sats dagen før", () => {
      expect(resolveRateAtDate(planned, "600.00", "2026-10-31")).toBe("600.00");
    });

    it("bruger den seneste af flere ændringer i kø der er trådt i kraft", () => {
      const queue = [
        change({ newRate: "800.00", effectiveDate: "2026-11-01" }),
        change({ newRate: "900.00", effectiveDate: "2027-01-01" }),
        change({ newRate: "1000.00", effectiveDate: "2027-06-01" }),
      ];
      expect(resolveRateAtDate(queue, "600.00", "2026-10-31")).toBe("600.00");
      expect(resolveRateAtDate(queue, "600.00", "2026-12-31")).toBe("800.00");
      expect(resolveRateAtDate(queue, "600.00", "2027-01-01")).toBe("900.00");
      expect(resolveRateAtDate(queue, "600.00", "2027-05-31")).toBe("900.00");
      expect(resolveRateAtDate(queue, "600.00", "2027-06-01")).toBe("1000.00");
    });

    it("lader den senest oprettede vinde ved to ændringer samme dag", () => {
      const sameDay = [
        change({ newRate: "750.00" }),
        change({ newRate: "800.00" }),
      ];
      expect(resolveRateAtDate(sameDay, "600.00", "2026-11-01")).toBe("800.00");
    });
  });

  describe("b. anvendt ændring", () => {
    const applied = [
      change({
        oldRate: "600.00",
        appliedAt: new Date(Date.UTC(2026, 9, 31, 23, 5)),
      }),
    ];

    it("giver den gamle sats til en post dateret før skiftet", () => {
      // Klienten står nu på 800, men posten ligger før 1/11
      expect(resolveRateAtDate(applied, "800.00", "2026-10-31")).toBe("600.00");
    });

    it("giver den nuværende sats på og efter datoen", () => {
      expect(resolveRateAtDate(applied, "800.00", "2026-11-01")).toBe("800.00");
      expect(resolveRateAtDate(applied, "800.00", "2027-02-01")).toBe("800.00");
    });

    it("bruger oldRate fra den tidligste anvendte ændring efter datoen", () => {
      const history = [
        change({
          effectiveDate: "2026-11-01",
          newRate: "800.00",
          oldRate: "600.00",
          appliedAt: new Date(Date.UTC(2026, 9, 31, 23, 5)),
        }),
        change({
          effectiveDate: "2027-01-01",
          newRate: "900.00",
          oldRate: "800.00",
          appliedAt: new Date(Date.UTC(2026, 11, 31, 23, 5)),
        }),
      ];
      expect(resolveRateAtDate(history, "900.00", "2026-06-01")).toBe("600.00");
      expect(resolveRateAtDate(history, "900.00", "2026-12-01")).toBe("800.00");
      expect(resolveRateAtDate(history, "900.00", "2027-01-01")).toBe("900.00");
    });

    it("giver null når satsen ikke fandtes før skiftet (falder videre i hierarkiet)", () => {
      const firstRate = [
        change({
          oldRate: null,
          appliedAt: new Date(Date.UTC(2026, 9, 31, 23, 5)),
        }),
      ];
      expect(resolveRateAtDate(firstRate, "800.00", "2026-10-01")).toBeNull();
    });

    it("kombinerer anvendt og planlagt ændring", () => {
      const mixed = [
        change({
          effectiveDate: "2026-11-01",
          oldRate: "600.00",
          appliedAt: new Date(Date.UTC(2026, 9, 31, 23, 5)),
        }),
        change({ effectiveDate: "2027-01-01", newRate: "900.00" }),
      ];
      expect(resolveRateAtDate(mixed, "800.00", "2026-10-15")).toBe("600.00");
      expect(resolveRateAtDate(mixed, "800.00", "2026-11-15")).toBe("800.00");
      expect(resolveRateAtDate(mixed, "800.00", "2027-01-01")).toBe("900.00");
    });
  });

  describe("c. uden relevante ændringer", () => {
    it("giver den nuværende sats uden ændringer", () => {
      expect(resolveRateAtDate([], "600.00", "2026-11-01")).toBe("600.00");
    });

    it("giver den nuværende sats uden dato (bagudkompatibelt)", () => {
      expect(resolveRateAtDate([change()], "600.00", undefined)).toBe("600.00");
    });

    it("ignorerer annullerede ændringer", () => {
      const cancelled = [
        change({ cancelledAt: new Date(Date.UTC(2026, 9, 1)) }),
        change({
          effectiveDate: "2026-12-01",
          oldRate: "500.00",
          appliedAt: new Date(Date.UTC(2026, 10, 30)),
          cancelledAt: new Date(Date.UTC(2026, 10, 30, 1)),
        }),
      ];
      expect(resolveRateAtDate(cancelled, "600.00", "2026-11-15")).toBe(
        "600.00",
      );
    });
  });
});

describe("indexScheduledChanges", () => {
  it("grupperer pr. klient og projekt og udelader annullerede", () => {
    const index = indexScheduledChanges([
      change(),
      change({ clientId: null, projectId: PROJECT }),
      change({ cancelledAt: new Date() }),
    ]);
    expect(index.byClient.get(CLIENT)).toHaveLength(1);
    expect(index.byProject.get(PROJECT)).toHaveLength(1);
  });
});

describe("toRateDateKey", () => {
  it("bruger en ren datostreng som den er", () => {
    expect(toRateDateKey("2026-11-01")).toBe("2026-11-01");
  });

  it("læser UTC-midnat som samme dag i dansk tid", () => {
    expect(toRateDateKey(new Date("2026-11-01T00:00:00.000Z"))).toBe(
      "2026-11-01",
    );
  });

  it("læser et sent tidspunkt i UTC som næste dag i dansk tid", () => {
    // 23:30 UTC 31/10 = 00:30 dansk tid 1/11 (vintertid, UTC+1)
    expect(toRateDateKey(new Date("2026-10-31T23:30:00.000Z"))).toBe(
      "2026-11-01",
    );
    expect(toRateDateKey("2026-10-31T23:30:00.000Z")).toBe("2026-11-01");
  });

  it("returnerer undefined for tomme og ugyldige værdier", () => {
    expect(toRateDateKey(undefined)).toBeUndefined();
    expect(toRateDateKey(null)).toBeUndefined();
    expect(toRateDateKey("ikke en dato")).toBeUndefined();
  });
});

describe("copenhagenToday", () => {
  it("skifter dag ved dansk midnat, ikke UTC-midnat", () => {
    // 22:30 UTC 31/10 = 23:30 dansk tid → stadig 31/10
    expect(copenhagenToday(new Date("2026-10-31T22:30:00.000Z"))).toBe(
      "2026-10-31",
    );
    // 23:05 UTC 31/10 = 00:05 dansk tid 1/11 → cron-kørslen ser 1/11
    expect(copenhagenToday(new Date("2026-10-31T23:05:00.000Z"))).toBe(
      "2026-11-01",
    );
  });
});
