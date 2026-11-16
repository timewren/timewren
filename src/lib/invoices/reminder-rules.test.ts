import { describe, expect, it } from "vitest";
import {
  B2B_KOMPENSATION_DKK,
  calcReminderCharges,
  isReminderDue,
  MORARENTE_AARLIG_PCT,
  RYKKERGEBYR_DKK,
} from "./reminder-rules";

const d = (s: string) => new Date(s);

describe("isReminderDue", () => {
  const base = { dueDate: d("2026-07-01T00:00:00"), lastReminderAt: null };

  it("ikke før dagen efter forfald", () => {
    expect(
      isReminderDue({ ...base, reminderCount: 0 }, d("2026-07-01T12:00:00")),
    ).toBe(false);
    expect(
      isReminderDue({ ...base, reminderCount: 0 }, d("2026-07-02T06:00:00")),
    ).toBe(true);
  });

  it("dagen efter forfald starter ved dansk midnat uanset proces-TZ (#649)", () => {
    // Forfald 1/7 gemt som UTC-midnat (konventionen for datokolonner)
    const state = {
      dueDate: d("2026-07-01T00:00:00Z"),
      lastReminderAt: null,
      reminderCount: 0,
    };
    // 1/7 23:59 dansk tid = 21:59Z — endnu ikke
    expect(isReminderDue(state, d("2026-07-01T21:59:00Z"))).toBe(false);
    // 2/7 00:00 dansk tid = 1/7 22:00Z — nu
    expect(isReminderDue(state, d("2026-07-01T22:00:00Z"))).toBe(true);
  });

  it("rykker 2 kræver 10 dages interval", () => {
    const state = {
      ...base,
      reminderCount: 1,
      lastReminderAt: d("2026-07-02T07:00:00"),
    };
    expect(isReminderDue(state, d("2026-07-11T07:00:00"))).toBe(false);
    expect(isReminderDue(state, d("2026-07-12T08:00:00"))).toBe(true);
  });

  it("maks 3 rykkere", () => {
    expect(
      isReminderDue(
        { ...base, reminderCount: 3, lastReminderAt: d("2026-07-22") },
        d("2026-12-01"),
      ),
    ).toBe(false);
  });
});

describe("calcReminderCharges", () => {
  it("rykker 1, privatkunde: 100 kr gebyr, ingen kompensation", () => {
    const c = calcReminderCharges({
      principal: 10000,
      reminderNumber: 1,
      daysOverdue: 10,
      isBusinessClient: false,
    });
    expect(c.totalFees).toBe(RYKKERGEBYR_DKK);
    expect(c.compensation).toBe(0);
    // 10.000 × 9,6 % × 10/365
    expect(c.accruedInterest).toBeCloseTo(26.3, 1);
  });

  it("rykker 3, B2B: 300 kr gebyr + 310 kr kompensation", () => {
    const c = calcReminderCharges({
      principal: 5000,
      reminderNumber: 3,
      daysOverdue: 30,
      isBusinessClient: true,
    });
    expect(c.totalFees).toBe(3 * RYKKERGEBYR_DKK);
    expect(c.compensation).toBe(B2B_KOMPENSATION_DKK);
    expect(c.totalClaim).toBeCloseTo(
      5000 + 300 + 310 + ((5000 * MORARENTE_AARLIG_PCT) / 100 / 365) * 30,
      1,
    );
  });

  it("rykkernummer klampes til 1-3", () => {
    expect(
      calcReminderCharges({
        principal: 1000,
        reminderNumber: 7,
        daysOverdue: 5,
        isBusinessClient: false,
      }).totalFees,
    ).toBe(300);
  });

  it("negative input giver 0-krav, ikke negative beløb", () => {
    const c = calcReminderCharges({
      principal: -50,
      reminderNumber: 1,
      daysOverdue: -3,
      isBusinessClient: false,
    });
    expect(c.accruedInterest).toBe(0);
    expect(c.totalClaim).toBe(100);
  });
});
