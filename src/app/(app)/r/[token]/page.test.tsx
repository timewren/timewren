import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import PublicReportPage from "./page";

const { owner } = vi.hoisted(() => ({ owner: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/components/LeveretAfTimeTrack", () => ({
  LeveretAfTimeTrack: () => null,
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  getClientIp: () => "",
  ipRateLimitKey: () => "",
  rateLimiter: { check: async () => ({ allowed: true }) },
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: owner },
      reportShares: {
        findFirst: async () => ({
          id: "share",
          userId: "owner",
          config: {},
        }),
      },
      companyProfiles: { findFirst: async () => null },
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));
vi.mock("@/lib/reports/date-range", () => ({
  resolveDateRange: () => ({ start: new Date(0), end: new Date(0) }),
}));
vi.mock("@/lib/reports/query", () => ({
  loadReportEntries: async () => [],
  aggregateReport: () => ({
    summary: {
      totalHours: 3,
      totalRevenue: 375,
      billedHours: 1,
      entriesCount: 2,
    },
    groups: [{ key: "project", label: "Design", hours: 1, revenue: 125 }],
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  owner.mockReset();
});

it.each([
  ["1", "demo-eur-abc@demo.invalid", " EUR"],
  ["1", "demo-abc@demo.invalid", " kr"],
  ["", "demo-eur-abc@demo.invalid", " kr"],
])(
  "formats anonymous shares in the owner's currency (demo=%s, owner=%s)",
  async (mode, email, suffix) => {
    vi.stubEnv("DEMO_MODE", mode);
    owner.mockResolvedValue({ email });

    const html = renderToStaticMarkup(
      await PublicReportPage({ params: Promise.resolve({ token: "report" }) }),
    );

    expect(html).toContain(`>375${suffix}</`);
    expect(html).toContain(`>125${suffix}</`);
    expect(owner).toHaveBeenCalledTimes(mode === "1" ? 1 : 0);
  },
);
