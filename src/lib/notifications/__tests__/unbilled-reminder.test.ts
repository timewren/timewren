import { describe, expect, it } from "vitest";
import {
  normalizeUnbilledReminderFrequency,
  shouldSendUnbilledReminder,
  UNBILLED_REMINDER_FOOTER_NOTES,
} from "@/lib/notifications/unbilled-reminder";

// Faste referencepunkter (dansk kalender):
//   2026-09-17 torsdag, 2026-09-18 fredag, 2026-09-19 lørdag, 2026-09-20 søndag
//   september 2026 slutter onsdag d. 30.
//   oktober 2026 slutter lørdag d. 31  -> sidste hverdag = fredag d. 30.
//   januar 2027 slutter søndag d. 31   -> sidste hverdag = fredag d. 29.
const at = (iso: string) => new Date(iso);

describe("shouldSendUnbilledReminder", () => {
  describe("weekly", () => {
    it("sender om fredagen", () => {
      expect(
        shouldSendUnbilledReminder("weekly", at("2026-09-18T08:00:00Z")),
      ).toBe(true);
    });

    it("sender ikke de øvrige dage", () => {
      for (const iso of [
        "2026-09-14T08:00:00Z", // mandag
        "2026-09-17T08:00:00Z", // torsdag
        "2026-09-19T08:00:00Z", // lørdag
        "2026-09-20T08:00:00Z", // søndag
      ]) {
        expect(shouldSendUnbilledReminder("weekly", at(iso))).toBe(false);
      }
    });

    it("bruger dansk tid, ikke UTC — fredag 23:30 UTC er lørdag i Danmark", () => {
      expect(
        shouldSendUnbilledReminder("weekly", at("2026-09-18T23:30:00Z")),
      ).toBe(false);
    });

    it("er default for ukendte/manglende værdier", () => {
      const friday = at("2026-09-18T08:00:00Z");
      const thursday = at("2026-09-17T08:00:00Z");
      for (const value of [null, undefined, "", "yearly"]) {
        expect(shouldSendUnbilledReminder(value, friday)).toBe(true);
        expect(shouldSendUnbilledReminder(value, thursday)).toBe(false);
      }
    });
  });

  describe("daily", () => {
    it("sender alle hverdage", () => {
      for (const iso of [
        "2026-09-14T08:00:00Z", // mandag
        "2026-09-15T08:00:00Z",
        "2026-09-16T08:00:00Z",
        "2026-09-17T08:00:00Z",
        "2026-09-18T08:00:00Z", // fredag
      ]) {
        expect(shouldSendUnbilledReminder("daily", at(iso))).toBe(true);
      }
    });

    it("sender ikke i weekenden", () => {
      expect(
        shouldSendUnbilledReminder("daily", at("2026-09-19T08:00:00Z")),
      ).toBe(false);
      expect(
        shouldSendUnbilledReminder("daily", at("2026-09-20T08:00:00Z")),
      ).toBe(false);
    });
  });

  describe("monthly", () => {
    it("sender på månedens sidste dag når den er en hverdag", () => {
      // 30. september 2026 = onsdag
      expect(
        shouldSendUnbilledReminder("monthly", at("2026-09-30T08:00:00Z")),
      ).toBe(true);
      expect(
        shouldSendUnbilledReminder("monthly", at("2026-09-29T08:00:00Z")),
      ).toBe(false);
    });

    it("rykker til fredagen når måneden slutter i weekenden (lørdag)", () => {
      // Oktober 2026 slutter lørdag d. 31 -> fredag d. 30 er sidste hverdag
      expect(
        shouldSendUnbilledReminder("monthly", at("2026-10-30T08:00:00Z")),
      ).toBe(true);
      expect(
        shouldSendUnbilledReminder("monthly", at("2026-10-31T08:00:00Z")),
      ).toBe(false);
    });

    it("rykker til fredagen når måneden slutter søndag", () => {
      // Januar 2027 slutter søndag d. 31 -> fredag d. 29 er sidste hverdag
      expect(
        shouldSendUnbilledReminder("monthly", at("2027-01-29T08:00:00Z")),
      ).toBe(true);
      for (const iso of ["2027-01-28T08:00:00Z", "2027-01-31T08:00:00Z"]) {
        expect(shouldSendUnbilledReminder("monthly", at(iso))).toBe(false);
      }
    });

    it("sender kun én dag pr. måned", () => {
      const hits = [];
      for (let day = 1; day <= 31; day++) {
        const iso = `2026-10-${String(day).padStart(2, "0")}T08:00:00Z`;
        if (shouldSendUnbilledReminder("monthly", at(iso))) hits.push(day);
      }
      expect(hits).toEqual([30]);
    });
  });
});

describe("normalizeUnbilledReminderFrequency", () => {
  it("falder tilbage til weekly", () => {
    expect(normalizeUnbilledReminderFrequency(null)).toBe("weekly");
    expect(normalizeUnbilledReminderFrequency("nonsens")).toBe("weekly");
  });

  it("bevarer gyldige værdier", () => {
    expect(normalizeUnbilledReminderFrequency("daily")).toBe("daily");
    expect(normalizeUnbilledReminderFrequency("monthly")).toBe("monthly");
  });
});

describe("UNBILLED_REMINDER_FOOTER_NOTES", () => {
  it("matcher kadencen", () => {
    expect(UNBILLED_REMINDER_FOOTER_NOTES.daily).toContain("hver hverdag");
    expect(UNBILLED_REMINDER_FOOTER_NOTES.weekly).toContain("hver fredag");
    expect(UNBILLED_REMINDER_FOOTER_NOTES.monthly).toContain(
      "sidst på måneden",
    );
  });
});
