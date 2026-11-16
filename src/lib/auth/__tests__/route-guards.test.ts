import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActiveOrgId: vi.fn(),
  resolveModuleAccess: vi.fn(),
  isEnabled: vi.fn(),
  resolveModules: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: mocks.resolveActiveOrgId,
}));
vi.mock("@/lib/trpc/routers/enterprise/middleware", () => ({
  resolveModules: mocks.resolveModules,
}));
vi.mock("@/lib/permissions/role-access", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/permissions/role-access")
  >("@/lib/permissions/role-access");
  return { ...actual, resolveModuleAccess: mocks.resolveModuleAccess };
});
vi.mock("@/i18n/server-text", () => ({
  tr: async (_ns: string, key: string) => key,
}));

const { requireInvoiceRouteAccess } = await import("../route-guards");
const { orglessForbiddenMessage } = await import("../orgless");

const headers = new Headers();

describe("requireInvoiceRouteAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.resolveActiveOrgId.mockResolvedValue("org-1");
    mocks.resolveModuleAccess.mockResolvedValue("write");
    mocks.isEnabled.mockReturnValue(true);
    mocks.resolveModules.mockResolvedValue({ isEnabled: mocks.isEnabled });
  });

  it("afviser uden session med 401", async () => {
    mocks.getSession.mockResolvedValue(null);
    const res = await requireInvoiceRouteAccess({
      headers,
      moduleKey: "invoices",
      featureModule: "invoicing",
      required: "read",
    });
    expect(res).toEqual({ ok: false, status: 401, error: "Unauthorized" });
    expect(mocks.resolveActiveOrgId).not.toHaveBeenCalled();
  });

  it("afviser en bruger uden aktiv organisation med 403", async () => {
    mocks.resolveActiveOrgId.mockResolvedValue(null);
    const res = await requireInvoiceRouteAccess({
      headers,
      moduleKey: "invoices",
      featureModule: "invoicing",
      required: "read",
    });
    expect(res).toEqual({
      ok: false,
      status: 403,
      error: orglessForbiddenMessage(),
    });
    expect(mocks.resolveModuleAccess).not.toHaveBeenCalled();
  });

  it("afviser læseadgang, når handlingen kræver skriveadgang", async () => {
    mocks.resolveModuleAccess.mockResolvedValue("read");
    const res = await requireInvoiceRouteAccess({
      headers,
      moduleKey: "invoices",
      featureModule: "invoicing",
      required: "write",
    });
    expect(res).toEqual({
      ok: false,
      status: 403,
      error: "core.roleNoAccess",
    });
    expect(mocks.resolveModuleAccess).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "org-1",
      "invoices",
    );
  });

  it("giver adgang med brugerens og organisationens id", async () => {
    const res = await requireInvoiceRouteAccess({
      headers,
      moduleKey: "invoices",
      featureModule: "invoicing",
      required: "write",
    });
    expect(res).toEqual({ ok: true, userId: "user-1", orgId: "org-1" });
  });

  it("afviser, når organisationen har slået modulet fra", async () => {
    mocks.isEnabled.mockReturnValue(false);
    const res = await requireInvoiceRouteAccess({
      headers,
      moduleKey: "invoices",
      featureModule: "invoicing",
      required: "read",
    });
    expect(res).toEqual({
      ok: false,
      status: 403,
      error: "core.moduleDisabled",
    });
    expect(mocks.resolveModules).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
    );
    expect(mocks.isEnabled).toHaveBeenCalledWith("invoicing");
    expect(mocks.resolveModuleAccess).not.toHaveBeenCalled();
  });
});
