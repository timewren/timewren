// @vitest-environment happy-dom
/**
 * Appens tekster følger hostens brand, ikke build-brandet (TimeWren Cloud).
 *
 * Prod bygges med NEXT_PUBLIC_BRAND=timetrack, men på timewren.com kører samme
 * build med TimeWren som brand: (app)-layoutet lægger en BrandProvider om
 * siden, og dashboardets kataloger er brandiseret efter hosten. Testen
 * renderer et udvalg af app-komponenter begge veje:
 *
 * - timetrack (ingen provider, som på timetrack.dk): teksten skal være præcis
 *   som før (snapshot taget af koden før ændringen).
 * - timewren (provider + kataloger som på timewren.com): ingen "TimeTrack" i
 *   tekst eller attributter, bortset fra ALLOWED herunder.
 */
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BrandProvider } from "@/components/BrandContext";
import { brandize } from "@/i18n/brandize";
import { loadMessages } from "@/i18n/messages/load";
import { getBrand } from "@/lib/brand";
import { ThemeProvider } from "@/providers/theme-provider";

/**
 * Bevidste "TimeTrack"-omtaler på TimeWren. Tom: ingen app-flade må nævne
 * TimeTrack for en TimeWren-konto.
 */
const ALLOWED: RegExp[] = [];

// tRPC: hver query er tom og færdig (medmindre QUERY_DATA har svaret), hver
// mutation en no-op. Komponenterne renderer så deres standardtilstand.
const QUERY_DATA: Record<string, unknown> = {
  "onboarding.demoStatus": { hasDemoData: true },
  "user.getDismissedBanners": [],
};

function trpcProxy(path: string[] = []): unknown {
  const fn = () => {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === "then") return undefined;
      if (prop === "useQuery" || prop === "useSuspenseQuery") {
        return () => ({
          data: QUERY_DATA[path.join(".")],
          isLoading: false,
          isPending: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        });
      }
      if (prop === "useInfiniteQuery") {
        return () => ({
          data: undefined,
          isLoading: false,
          hasNextPage: false,
          fetchNextPage: vi.fn(),
        });
      }
      if (prop === "useMutation") {
        return () => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn(),
          isPending: false,
          reset: vi.fn(),
        });
      }
      return trpcProxy([...path, String(prop)]);
    },
    apply() {
      return trpcProxy(path);
    },
  });
}

vi.mock("@/content/testimonials", async () => {
  const { FIXTURE_TESTIMONIALS } = await import(
    "@/content/testimonials.fixture"
  );
  return {
    TESTIMONIALS: FIXTURE_TESTIMONIALS,
    approvedTestimonials: () => FIXTURE_TESTIMONIALS,
  };
});
vi.mock("@/providers/trpc-provider", () => ({ trpc: trpcProxy() }));
// Ingen GitHub-kald: desktop-kortet viser sin "på vej"-tilstand.
vi.mock("@/components/desktop/useLatestDesktopRelease", () => ({
  useLatestDesktopRelease: () => ({
    loaded: true,
    os: "other",
    version: null,
    winUrl: null,
    macUrl: null,
    hasDownloads: false,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({
    data: { user: { id: "u1", name: "Test", email: "test@example.com" } },
    isPending: false,
  }),
  useActiveOrganization: () => ({ data: null, isPending: false }),
  useListOrganizations: () => ({ data: [], isPending: false }),
  signOut: vi.fn(),
  authClient: {},
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
  }),
}));

type Case = [
  name: string,
  load: () => Promise<ReactElement>,
  /** Valgfrit: klik o.l. efter render, fx for at åbne en menu. */
  interact?: (root: HTMLElement) => void,
];

const noop = () => {};
const CASES: Case[] = [
  [
    "onboarding/SubscriptionStep",
    async () => {
      const { SubscriptionStep } = await import(
        "@/components/onboarding/SubscriptionStep"
      );
      return <SubscriptionStep onNext={noop} />;
    },
  ],
  [
    "onboarding/DataImportStep",
    async () => {
      const { DataImportStep } = await import(
        "@/components/onboarding/DataImportStep"
      );
      return <DataImportStep onNext={noop} onBack={noop} />;
    },
  ],
  [
    "onboarding/AISetupStep",
    async () => {
      const { AISetupStep } = await import(
        "@/components/onboarding/AISetupStep"
      );
      return <AISetupStep onNext={noop} onBack={noop} />;
    },
  ],
  [
    "onboarding/PaymentStep",
    async () => {
      const { PaymentStep } = await import(
        "@/components/onboarding/PaymentStep"
      );
      return <PaymentStep onNext={noop} onSkip={noop} onBack={noop} />;
    },
  ],
  [
    "onboarding/CompleteStep",
    async () => {
      const { CompleteStep } = await import(
        "@/components/onboarding/CompleteStep"
      );
      return <CompleteStep onFinish={noop} />;
    },
  ],
  [
    "home/HomeWelcome",
    async () => {
      const { HomeWelcome } = await import("@/components/home/HomeWelcome");
      return <HomeWelcome showFirstTimer showSurvey primaryUse={null} />;
    },
  ],
  [
    "dashboard/DemoDataBanner",
    async () => {
      const { DemoDataBanner } = await import(
        "@/components/dashboard/DemoDataBanner"
      );
      return <DemoDataBanner />;
    },
  ],
  [
    "dashboard/DesktopDownloadCard",
    async () => {
      const { DesktopDownloadCard } = await import(
        "@/components/dashboard/DesktopDownloadCard"
      );
      return <DesktopDownloadCard />;
    },
  ],
  [
    "settings/UserExportCard",
    async () => {
      const { UserExportCard } = await import(
        "@/components/settings/UserExportCard"
      );
      return <UserExportCard />;
    },
  ],
  [
    "settings/OrgExportCard",
    async () => {
      const { OrgExportCard } = await import(
        "@/components/settings/OrgExportCard"
      );
      return <OrgExportCard />;
    },
  ],
  [
    "settings/DpaCard",
    async () => {
      const { DpaCard } = await import("@/components/settings/DpaCard");
      return <DpaCard />;
    },
  ],
  [
    "settings/ConnectedAiAppsSection",
    async () => {
      const { ConnectedAiAppsSection } = await import(
        "@/components/settings/ConnectedAiAppsSection"
      );
      return <ConnectedAiAppsSection />;
    },
  ],
  [
    "subscription/TrialExpiredWall",
    async () => {
      const { TrialExpiredWall } = await import(
        "@/components/subscription/TrialExpiredWall"
      );
      return (
        <TrialExpiredWall
          subscription={
            {
              planTier: "solo",
              status: "trialing",
              trialEndsAt: new Date("2026-01-01T00:00:00Z"),
              billingCycle: "monthly",
            } as never
          }
        />
      );
    },
  ],
  [
    "calendar/ICloudCalendarSection",
    async () => {
      const { ICloudCalendarSection } = await import(
        "@/components/calendar/ICloudCalendarSection"
      );
      return <ICloudCalendarSection />;
    },
  ],
  ...(
    [
      ["page:help", () => import("@/app/(app)/dashboard/help/page")],
      ["page:register", () => import("@/app/(app)/register/page")],
      [
        "page:forgot-password",
        () => import("@/app/(app)/auth/forgot-password/page"),
      ],
      [
        "page:accept-invitation",
        () => import("@/app/(app)/auth/accept-invitation/page"),
      ],
      ["page:device", () => import("@/app/(app)/auth/device/page")],
      ["page:offline", () => import("@/app/(app)/offline/page")],
      ["page:auth/extension", () => import("@/app/(app)/auth/extension/page")],
      ["page:auth/desktop", () => import("@/app/(app)/auth/desktop/page")],
      [
        "page:settings/desktop",
        () => import("@/app/(app)/dashboard/settings/desktop/page"),
      ],
      [
        "page:settings/data",
        () => import("@/app/(app)/dashboard/settings/data/page"),
      ],
      [
        "page:import-timeops",
        () => import("@/app/(app)/dashboard/integrations/import-timeops/page"),
      ],
      ["page:settings", () => import("@/app/(app)/dashboard/settings/page")],
      [
        "page:settings/ai",
        () => import("@/app/(app)/dashboard/settings/ai/page"),
      ],
      [
        "page:settings/api",
        () => import("@/app/(app)/dashboard/settings/api/page"),
      ],
      [
        "page:settings/integrations",
        () => import("@/app/(app)/dashboard/settings/integrations/page"),
      ],
      [
        "page:settings/notifications",
        () => import("@/app/(app)/dashboard/settings/notifications/page"),
      ],
      [
        "page:settings/subscription",
        () => import("@/app/(app)/dashboard/settings/subscription/page"),
      ],
      [
        "page:calendar/setup",
        () => import("@/app/(app)/dashboard/calendar/setup/page"),
      ],
    ] as const
  ).map(
    ([name, imp]): Case => [
      name,
      async () => {
        const Page = (await imp()).default as () => ReactElement;
        return <Page />;
      },
    ],
  ),
  [
    "dashboard/AppDrawer (åben)",
    async () => {
      const { AppDrawer } = await import("@/components/dashboard/AppDrawer");
      return <AppDrawer />;
    },
    (root) =>
      root
        .querySelector<HTMLButtonElement>('button[aria-label="Apps"]')
        ?.click(),
  ],
  [
    "subscription/StoreSubscriptionCard",
    async () => {
      const { StoreSubscriptionCard } = await import(
        "@/components/subscription/StoreSubscriptionCard"
      );
      return (
        <StoreSubscriptionCard
          details={{
            planName: "Selvstændig",
            billingCycle: "monthly",
            storeProvider: "app_store",
            storeStatus: "active",
            storeManageUrl: null,
            currentPeriodEnd: "2026-12-01T00:00:00Z",
            cancelAtPeriodEnd: false,
          }}
        />
      );
    },
  ],
  [
    "enterprise/AuditEntryList",
    async () => {
      const { AuditEntryList } = await import(
        "@/components/enterprise/AuditEntryList"
      );
      return (
        <AuditEntryList
          entries={[
            {
              id: "a1",
              action: "admin_impersonation_started",
              createdAt: "2026-11-01T10:00:00Z",
              metadata: { targetName: "Test" },
              actor: { id: "u1", name: "Support" },
            },
          ]}
        />
      );
    },
  ],
  [
    "LeveretAfTimeTrack",
    async () => {
      const { LeveretAfTimeTrack } = await import(
        "@/components/LeveretAfTimeTrack"
      );
      return <LeveretAfTimeTrack />;
    },
  ],
];

let da: Record<string, unknown>;
beforeAll(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  da = (await loadMessages("da")) as Record<string, unknown>;
  // Ingen netværk: sider, der henter selv (fx /api/...), får et tomt svar.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

/** Synlig tekst plus de attributter, en bruger eller skærmlæser møder. */
function visibleText(root: HTMLElement): string {
  const attrs: string[] = [];
  for (const el of root.querySelectorAll("*")) {
    for (const a of ["title", "aria-label", "placeholder", "alt", "href"]) {
      const v = el.getAttribute(a);
      if (v) attrs.push(`[${a}=${v}]`);
    }
  }
  const text = (root.textContent ?? "").replace(/\s+/g, " ").trim();
  return `${text}\n${attrs.join("\n")}`;
}

async function renderAs(
  brandId: "timetrack" | "timewren",
  element: ReactElement,
  interact?: Case[2],
): Promise<string> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const b = getBrand(brandId);
  const inner = (
    <NextIntlClientProvider
      locale="da"
      messages={brandize(da, brandId)}
      onError={noop}
      timeZone="Europe/Copenhagen"
    >
      <ThemeProvider>{element}</ThemeProvider>
    </NextIntlClientProvider>
  );
  // timetrack: ingen provider, præcis som (app)-layoutet på timetrack.dk.
  const tree =
    brandId === "timetrack" ? (
      inner
    ) : (
      <BrandProvider value={b}>{inner}</BrandProvider>
    );
  await act(async () => root.render(tree));
  if (interact) await act(async () => interact(container));
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return visibleText(container);
}

describe.each(CASES)("%s", (_name, load, interact) => {
  it("timetrack: uændret tekst", async () => {
    const text = await renderAs("timetrack", await load(), interact);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatchSnapshot();
  });

  it("timewren: ingen TimeTrack", async () => {
    const text = await renderAs("timewren", await load(), interact);
    const hits = (text.match(/[^\n]{0,40}TimeTrack[^\n]{0,40}/g) ?? []).filter(
      (hit) => !ALLOWED.some((re) => re.test(hit)),
    );
    expect(hits).toEqual([]);
  });
});
