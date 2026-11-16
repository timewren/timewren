import { describe, expect, it } from "vitest";
import {
  canApproveWeek,
  canRejectWeek,
  canReopenWeek,
  canSubmitWeek,
  isWeekEditable,
  WEEK_EVENT_LABELS,
  WEEK_STATUS_LABELS,
} from "@/lib/enterprise/timesheet-week-status";

describe("timesheet week status — reopen-semantik (#466)", () => {
  it("kladde (ingen række), afvist og genåbnet er redigerbare", () => {
    expect(isWeekEditable(null)).toBe(true);
    expect(isWeekEditable(undefined)).toBe(true);
    expect(isWeekEditable("rejected")).toBe(true);
    expect(isWeekEditable("reopened")).toBe(true);
  });

  it("indsendt og godkendt er låst", () => {
    expect(isWeekEditable("submitted")).toBe(false);
    expect(isWeekEditable("approved")).toBe(false);
  });

  it("genåbnet uge kan indsendes igen — indsendt/godkendt kan ikke", () => {
    expect(canSubmitWeek("reopened")).toBe(true);
    expect(canSubmitWeek("rejected")).toBe(true);
    expect(canSubmitWeek(null)).toBe(true);
    expect(canSubmitWeek("submitted")).toBe(false);
    expect(canSubmitWeek("approved")).toBe(false);
  });

  it("leder kan godkende alt undtagen allerede godkendt (også genåbnet)", () => {
    expect(canApproveWeek(null)).toBe(true);
    expect(canApproveWeek("submitted")).toBe(true);
    expect(canApproveWeek("rejected")).toBe(true);
    expect(canApproveWeek("reopened")).toBe(true);
    expect(canApproveWeek("approved")).toBe(false);
  });

  it("kun indsendte kan afvises; kun godkendte kan genåbnes", () => {
    expect(canRejectWeek("submitted")).toBe(true);
    expect(canRejectWeek("reopened")).toBe(false);
    expect(canRejectWeek("approved")).toBe(false);
    expect(canReopenWeek("approved")).toBe(true);
    expect(canReopenWeek("reopened")).toBe(false);
    expect(canReopenWeek("submitted")).toBe(false);
  });

  it("den fulde cyklus indsend → godkend → genåbn → indsend → godkend er lovlig", () => {
    let status: string | null = null;
    expect(canSubmitWeek(status)).toBe(true);
    status = "submitted";
    expect(canApproveWeek(status)).toBe(true);
    status = "approved";
    expect(canReopenWeek(status)).toBe(true);
    status = "reopened";
    expect(isWeekEditable(status)).toBe(true);
    expect(canSubmitWeek(status)).toBe(true);
    status = "submitted";
    expect(canApproveWeek(status)).toBe(true);
  });

  it("har danske labels for alle statusser og hændelser", () => {
    expect(WEEK_STATUS_LABELS.reopened).toBe("Genåbnet");
    expect(WEEK_STATUS_LABELS.draft).toBe("Kladde");
    expect(Object.keys(WEEK_EVENT_LABELS).sort()).toEqual([
      "approved",
      "rejected",
      "reopened",
      "submitted",
    ]);
  });
});
