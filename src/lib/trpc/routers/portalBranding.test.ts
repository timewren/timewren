import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../trpc", async () => {
  const { initTRPC } = await import("@trpc/server");
  const t = initTRPC.create();
  return { router: t.router, protectedProcedure: t.procedure };
});
vi.mock("@/lib/hosting/dokploy", () => ({
  registerDomainWithDokploy: vi.fn(),
  removeDomainFromDokploy: vi.fn(),
}));

afterEach(() => vi.unstubAllEnvs());

describe("portal domain instructions", () => {
  it.each([
    ["https://public.example.org:8443", "public.example.org"],
    ["", "app.example.org"],
    ["https://timetrack.dk", "timetrack.dk"],
  ])(
    "uses the configured host %s as CNAME target",
    async (marketing, target) => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.org:3000");
      vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", marketing);
      const { portalBrandingRouter } = await import("./portalBranding");
      const db = {
        update: () => ({
          set: () => ({
            where: () => ({ returning: async () => [{ id: "branding-test" }] }),
          }),
        }),
      };
      const caller = portalBrandingRouter.createCaller({
        session: { user: { id: "user-test" } },
        orgId: null,
        db,
      } as unknown as Parameters<typeof portalBrandingRouter.createCaller>[0]);
      const result = await caller.setCustomDomain({
        customDomain: "portal.example.net",
      });
      expect(result.verificationInstructions.cnameRecord.value).toBe(target);
    },
  );
});

describe("removeCustomDomain", () => {
  async function removeWith(row: Record<string, unknown>) {
    const { portalBrandingRouter } = await import("./portalBranding");
    const { removeDomainFromDokploy } = await import("@/lib/hosting/dokploy");
    vi.mocked(removeDomainFromDokploy).mockClear();
    const db = {
      query: { portalBranding: { findFirst: async () => row } },
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [{ id: "branding-test" }] }),
        }),
      }),
    };
    const caller = portalBrandingRouter.createCaller({
      session: { user: { id: "user-test" } },
      orgId: "org-test",
      db,
    } as unknown as Parameters<typeof portalBrandingRouter.createCaller>[0]);
    await caller.removeCustomDomain();
    return vi.mocked(removeDomainFromDokploy);
  }

  it("leaves Dokploy alone for a domain the org never verified", async () => {
    // Anyone can type any host into setCustomDomain, e.g. another tenant's
    // verified portal domain; removing it must not delete their Dokploy entry.
    const remove = await removeWith({
      customDomain: "portal.example.net",
      customDomainVerified: false,
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes a verified domain from Dokploy", async () => {
    const remove = await removeWith({
      customDomain: "portal.example.net",
      customDomainVerified: true,
    });
    expect(remove).toHaveBeenCalledWith("portal.example.net");
  });
});
