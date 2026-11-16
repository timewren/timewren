import { describe, expect, it } from "vitest";
import {
  isEntryEligibleForApproval,
  PENDING_ELIGIBLE,
  periodLabel,
} from "@/lib/approval/eligibility";

describe("isEntryEligibleForApproval", () => {
  const base = {
    isBilled: false as boolean | null,
    isPrepaid: false as boolean | null,
    approvalStatus: "not_required" as string | null,
  };

  it("tillader ufaktureret, ikke-prepaid, not_required tid", () => {
    expect(isEntryEligibleForApproval(base)).toBe(true);
  });

  it("tillader afvist tid at blive sendt igen", () => {
    expect(
      isEntryEligibleForApproval({ ...base, approvalStatus: "rejected" }),
    ).toBe(true);
  });

  it("behandler manglende approvalStatus som not_required", () => {
    expect(isEntryEligibleForApproval({ ...base, approvalStatus: null })).toBe(
      true,
    );
  });

  it("afviser allerede faktureret tid", () => {
    expect(isEntryEligibleForApproval({ ...base, isBilled: true })).toBe(false);
  });

  it("afviser klippekort-tid (allerede betalt)", () => {
    expect(isEntryEligibleForApproval({ ...base, isPrepaid: true })).toBe(
      false,
    );
  });

  it("afviser tid der allerede afventer godkendelse", () => {
    expect(
      isEntryEligibleForApproval({ ...base, approvalStatus: "pending" }),
    ).toBe(false);
  });

  it("afviser allerede godkendt tid", () => {
    expect(
      isEntryEligibleForApproval({ ...base, approvalStatus: "approved" }),
    ).toBe(false);
  });

  it("PENDING_ELIGIBLE indeholder kun not_required og rejected", () => {
    expect([...PENDING_ELIGIBLE].sort()).toEqual(["not_required", "rejected"]);
  });
});

describe("periodLabel", () => {
  it("beskriver et fakturaudkast", () => {
    expect(periodLabel("invoice_draft", null, null)).toBe("et fakturaudkast");
  });

  it("beskriver en datoperiode", () => {
    expect(periodLabel("period", "2026-06-01", "2026-06-30")).toBe(
      "perioden 2026-06-01 – 2026-06-30",
    );
  });

  it("falder tilbage til generisk periode uden datoer", () => {
    expect(periodLabel("period", null, null)).toBe("en periode");
  });
});
