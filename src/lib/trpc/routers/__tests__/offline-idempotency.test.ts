import { describe, expect, it, vi } from "vitest";

// Routerne trækker ../trpc → auth → db ind; mock forbindelsen.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/email/engagement", () => ({ sendFirstTimeEntryEmail: vi.fn() }));
vi.mock("@/lib/email/prepaid", () => ({ sendLowBalanceAlert: vi.fn() }));

import { asDeduplicatedCreate } from "../time";
import { isSameClientOp } from "../timerSync";

describe("isSameClientOp (køet timerstart, #703)", () => {
  it("genkender samme nøgle som en afspilning", () => {
    const op = "11111111-1111-4111-8111-111111111111";
    expect(isSameClientOp(op, op)).toBe(true);
  });

  it("lader en tom kolonne eller en anden nøgle skrive", () => {
    const op = "11111111-1111-4111-8111-111111111111";
    expect(isSameClientOp(null, op)).toBe(false);
    expect(isSameClientOp(undefined, op)).toBe(false);
    expect(isSameClientOp(op, undefined)).toBe(false);
    expect(isSameClientOp("22222222-2222-4222-8222-222222222222", op)).toBe(
      false,
    );
  });
});

describe("asDeduplicatedCreate (time.create med clientEntryId, #703)", () => {
  it("returnerer den eksisterende post uden klippekort-træk eller advarsler", () => {
    const existing = { id: "e1", hours: "1.00", clientEntryId: "k1" };
    expect(asDeduplicatedCreate(existing)).toEqual({
      id: "e1",
      hours: "1.00",
      clientEntryId: "k1",
      prepaidDeduction: null,
      complianceWarnings: [],
      deduplicated: true,
    });
  });
});
