import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(["timewren", "timetrack"])(
  "localises records only for %s",
  async (brand) => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", brand);
    vi.resetModules();
    const { mainNavGroups } = await import(
      "../../src/components/dashboard-nav/navigation-config"
    );
    const item = mainNavGroups
      .flatMap((group) => group.items)
      .find((item) => item.href === "/dashboard/my-records");
    expect(item?.name).toBe("Mine registreringer");
    expect(item?.translationKey).toBe(
      brand === "timewren" ? "myRecords" : undefined,
    );
  },
);
