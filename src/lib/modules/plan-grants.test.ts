import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/enterprise/absence-defaults", () => ({
  ensureDefaultAbsenceTypes: vi.fn().mockResolvedValue([]),
}));

import { ensureDefaultAbsenceTypes } from "@/lib/enterprise/absence-defaults";
import {
  grantEnterpriseForTier,
  grantEnterpriseForTierSafe,
  tierGrantsEnterprise,
} from "./plan-grants";

type GrantDb = Parameters<typeof grantEnterpriseForTier>[0];

function makeDb(returned: Array<{ id: string }>) {
  const db = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returned),
  };
  return db;
}

describe("tierGrantsEnterprise", () => {
  it("kun business giver enterprise", () => {
    expect(tierGrantsEnterprise("business")).toBe(true);
    for (const tier of [
      "free",
      "privat",
      "solo",
      "team",
      "",
      null,
      undefined,
    ]) {
      expect(tierGrantsEnterprise(tier)).toBe(false);
    }
  });
});

describe("grantEnterpriseForTier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("er en no-op for andre tiers (nedgradering fjerner intet)", async () => {
    const db = makeDb([{ id: "m1" }]);
    for (const tier of ["solo", "team", "free", null]) {
      const res = await grantEnterpriseForTier(
        db as unknown as GrantDb,
        "org_1",
        tier,
      );
      expect(res).toBe(false);
    }
    expect(db.insert).not.toHaveBeenCalled();
    expect(ensureDefaultAbsenceTypes).not.toHaveBeenCalled();
  });

  it("er en no-op uden org", async () => {
    const db = makeDb([{ id: "m1" }]);
    expect(
      await grantEnterpriseForTier(db as unknown as GrantDb, null, "business"),
    ).toBe(false);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("upserter enterprise som tilgængelig + tændt og seeder fraværstyper", async () => {
    const db = makeDb([{ id: "m1" }]);
    const res = await grantEnterpriseForTier(
      db as unknown as GrantDb,
      "org_1",
      "business",
    );
    expect(res).toBe(true);
    const row = db.values.mock.calls[0][0];
    expect(row).toMatchObject({
      organizationId: "org_1",
      moduleKey: "enterprise",
      isAvailable: true,
      isEnabled: true,
    });
    const conflict = db.onConflictDoUpdate.mock.calls[0][0];
    expect(conflict.setWhere).toBeDefined();
    expect(ensureDefaultAbsenceTypes).toHaveBeenCalledWith(db, "org_1");
  });

  it("rører ikke fraværstyper når modulet allerede var tildelt (idempotent)", async () => {
    const db = makeDb([]);
    const res = await grantEnterpriseForTier(
      db as unknown as GrantDb,
      "org_1",
      "business",
    );
    expect(res).toBe(false);
    expect(ensureDefaultAbsenceTypes).not.toHaveBeenCalled();
  });
});

describe("grantEnterpriseForTierSafe", () => {
  it("sluger fejl så billing-flows ikke vælter", async () => {
    const db = makeDb([]);
    db.returning.mockRejectedValueOnce(new Error("db nede"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      grantEnterpriseForTierSafe(
        db as unknown as GrantDb,
        "org_1",
        "business",
        "test",
      ),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
