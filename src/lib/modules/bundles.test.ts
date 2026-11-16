import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyBundle, bundleFor, seedNewOrgModules } from "./bundles";
import {
  CORE_BUNDLE,
  ENTERPRISE_BUNDLE,
  FREELANCE_BUNDLE,
  MODULE_KEYS,
} from "./constants";

describe("bundleFor", () => {
  it("returns FREELANCE_BUNDLE for freelance type", () => {
    expect(bundleFor("freelance")).toEqual(FREELANCE_BUNDLE);
  });

  it("returns ENTERPRISE_BUNDLE for enterprise type", () => {
    expect(bundleFor("enterprise")).toEqual(ENTERPRISE_BUNDLE);
  });

  it("returns FREELANCE_BUNDLE when type is undefined (default)", () => {
    expect(bundleFor(undefined)).toEqual(FREELANCE_BUNDLE);
  });
});

describe("CORE_BUNDLE", () => {
  it("indeholder præcis de fem kerne-moduler", () => {
    expect([...CORE_BUNDLE].sort()).toEqual(
      ["clients", "invoicing", "klippekort", "projects", "reports"].sort(),
    );
  });

  it("indeholder kun gyldige modul-nøgler", () => {
    for (const key of CORE_BUNDLE) {
      expect(MODULE_KEYS).toContain(key);
    }
  });

  it("indeholder ikke enterprise", () => {
    expect(CORE_BUNDLE).not.toContain("enterprise");
  });
});

describe("applyBundle", () => {
  const mockDb = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts one row per module in the bundle with isAvailable=true, isEnabled=true", async () => {
    await applyBundle(
      mockDb as unknown as Parameters<typeof applyBundle>[0],
      "org_123",
      FREELANCE_BUNDLE,
    );

    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    const valuesArg = mockDb.values.mock.calls[0][0];
    expect(valuesArg).toHaveLength(FREELANCE_BUNDLE.length);
    for (const row of valuesArg) {
      expect(row.organizationId).toBe("org_123");
      expect(row.isAvailable).toBe(true);
      expect(row.isEnabled).toBe(true);
      expect(FREELANCE_BUNDLE).toContain(row.moduleKey);
    }
  });

  it("sets availableAt and enabledAt timestamps", async () => {
    await applyBundle(
      mockDb as unknown as Parameters<typeof applyBundle>[0],
      "org_123",
      ENTERPRISE_BUNDLE,
    );
    const valuesArg = mockDb.values.mock.calls[0][0];
    for (const row of valuesArg) {
      expect(row.availableAt).toBeInstanceOf(Date);
      expect(row.enabledAt).toBeInstanceOf(Date);
    }
  });
});

describe("seedNewOrgModules", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const mockDb = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("seeder én række pr. modul-nøgle", async () => {
    await seedNewOrgModules(
      mockDb as unknown as Parameters<typeof seedNewOrgModules>[0],
      "org_123",
    );
    const rows = mockDb.values.mock.calls[0][0];
    expect(rows).toHaveLength(MODULE_KEYS.length);
  });

  it("tænder kun kerne-moduler, resten tilgængelige men slukkede", async () => {
    await seedNewOrgModules(
      mockDb as unknown as Parameters<typeof seedNewOrgModules>[0],
      "org_123",
    );
    const rows = mockDb.values.mock.calls[0][0] as Array<{
      moduleKey: string;
      isAvailable: boolean;
      isEnabled: boolean;
    }>;
    const byKey = new Map(rows.map((r) => [r.moduleKey, r]));

    expect(byKey.get("clients")?.isEnabled).toBe(true);
    expect(byKey.get("clients")?.isAvailable).toBe(true);
    expect(byKey.get("tasks")?.isEnabled).toBe(false);
    expect(byKey.get("tasks")?.isAvailable).toBe(true);
  });

  it("gør enterprise tilgængeligt men slukket ved signup som standard (Cloud-env)", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "test-key");
    vi.stubEnv("STRIPE_SECRET_KEY", "test-key");
    vi.stubEnv("STORE_BILLING_ENABLED", "1");
    await seedNewOrgModules(
      mockDb as unknown as Parameters<typeof seedNewOrgModules>[0],
      "org_123",
    );
    const rows = mockDb.values.mock.calls[0][0] as Array<{
      moduleKey: string;
      isAvailable: boolean;
      isEnabled: boolean;
    }>;
    const enterprise = rows.find((r) => r.moduleKey === "enterprise");
    expect(enterprise?.isAvailable).toBe(true);
    expect(enterprise?.isEnabled).toBe(false);
  });

  describe("uden billing (selvhost, #962)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("gør enterprise tilgængeligt som standard", async () => {
      vi.stubEnv("ALUNTA_API_KEY", "");
      vi.stubEnv("STRIPE_SECRET_KEY", "");
      vi.stubEnv("STORE_BILLING_ENABLED", "");
      await seedNewOrgModules(
        mockDb as unknown as Parameters<typeof seedNewOrgModules>[0],
        "org_123",
      );
      const rows = mockDb.values.mock.calls[0][0] as Array<{
        moduleKey: string;
        isAvailable: boolean;
        isEnabled: boolean;
      }>;
      const enterprise = rows.find((r) => r.moduleKey === "enterprise");
      expect(enterprise?.isAvailable).toBe(true);
      expect(enterprise?.isEnabled).toBe(false);
    });
  });
});
