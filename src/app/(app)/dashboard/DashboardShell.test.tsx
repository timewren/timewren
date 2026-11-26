import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  brandId: "timetrack",
  pathname: "/dashboard/my-records",
  subscription: {} as Record<string, unknown>,
}));
vi.mock("@/components/BrandContext", () => ({
  BrandLogo: () => null,
  useBrand: () => ({ id: state.brandId, name: state.brandId }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-intl", () => {
  const t = Object.assign((key: string) => key, {
    rich: (key: string) => key,
    has: () => true,
  });
  return { useTranslations: () => t };
});
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "member" } }, isPending: false }),
  signOut: vi.fn(),
}));
vi.mock("@/hooks/useBillingEnabled", () => ({
  useBillingEnabled: () => ({ enabled: true }),
}));
vi.mock("@/hooks/useOrgRole", () => ({
  useOrgRole: () => ({ role: "member", isResolved: true }),
}));
vi.mock("@/hooks/useModules", () => ({
  useModules: () => ({ isEnabled: () => true, orgProfile: "enterprise" }),
}));
vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => true }),
}));
vi.mock("@/hooks/useEnterpriseMemberHint", () => ({
  useEnterpriseMemberHint: () => true,
  usePersistEnterpriseMemberHint: vi.fn(),
}));
vi.mock("@/stores/tourStore", () => ({
  useTourStore: () => ({ hasCompletedTour: true }),
}));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    rolePermissions: {
      getMyPermissions: { useQuery: () => ({ data: [] }) },
      getMyRole: { useQuery: () => ({ data: { role: "member" } }) },
    },
    subscription: {
      getDetails: {
        useQuery: () => ({ data: state.subscription, isLoading: false }),
      },
    },
    user: {
      getProfile: { useQuery: () => ({ data: { onboardingCompleted: true } }) },
      dismissBanner: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    time: {
      myRecords: {
        useQuery: () => ({
          data: { entries: [], nextOffset: null },
          isLoading: false,
        }),
      },
    },
    useUtils: () => ({}),
  },
}));
vi.mock("@/components/admin/ImpersonationBanner", () => ({
  ImpersonationBanner: () => null,
}));
vi.mock("@/components/dashboard/AppDrawer", () => ({ AppDrawer: () => null }));
vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/components/ImportStatusBanner", () => ({
  ImportStatusBanner: () => null,
}));
vi.mock("@/components/KeyboardShortcutsModal", () => ({
  KeyboardShortcutsModal: () => null,
}));
vi.mock("@/components/Logo", () => ({ Logo: () => null }));
vi.mock("@/components/OAuthSignupTracker", () => ({
  OAuthSignupTracker: () => null,
}));
vi.mock("@/components/OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("@/components/offline/OfflineBanner", () => ({
  OfflineBanner: () => null,
}));
vi.mock("@/components/offline/OfflineQueueStatus", () => ({
  OfflineQueueStatus: () => null,
}));
vi.mock("@/components/subscription/TrialExpiredWall", () => ({
  TrialExpiredWall: () => <div>subscription-wall</div>,
}));
vi.mock("@/components/TimeTrackingBar", () => ({
  TimeTrackingBar: () => null,
}));
vi.mock("@/components/time/QuickTimeEntryModal", () => ({
  QuickTimeEntryModal: () => null,
}));
vi.mock("@/components/tour/tour-gate", () => ({
  shouldAutoStartTour: () => null,
}));
vi.mock("@/components/ui/LoadingScreen", () => ({ LoadingScreen: () => null }));
vi.mock("@/components/ui/UserAvatar", () => ({ UserAvatar: () => null }));
vi.mock("@/components/ChangelogDot", () => ({
  ChangelogDot: () => null,
  useHasUnseenChangelog: () => false,
}));
vi.mock("@/components/notifications/InboxBell", () => ({
  InboxBell: () => null,
}));

import DashboardShell from "./DashboardShell";
import MyRecordsPage from "./my-records/page";

it.each([
  { status: "trialing", isTrialExpired: true },
  { status: "past_due", pastDueSince: new Date(0).toISOString() },
  { status: "free", memberLocked: true },
])(
  "keeps own records accessible with blocked subscription %j",
  (subscription) => {
    state.subscription = subscription;
    state.pathname = "/dashboard/my-records";
    const html = renderToString(
      <DashboardShell>
        <MyRecordsPage />
      </DashboardShell>,
    );
    expect(html).toContain("Mine registreringer");
    expect(html).toContain("Hent CSV");
    expect(html).toContain("Hent PDF");
    expect(html).not.toContain("subscription-wall");

    state.pathname = "/dashboard/time";
    const blocked = renderToString(
      <DashboardShell>
        <div>private-dashboard</div>
      </DashboardShell>,
    );
    expect(blocked).toContain("subscription-wall");
    expect(blocked).not.toContain("private-dashboard");
  },
);

it.each([
  ["timewren", 7, true],
  ["timewren", 7.5, false],
  ["timetrack", 7.5, true],
  ["timetrack", 8, false],
])("gates %s after %s days past due (access: %s)", (brandId, days, access) => {
  vi.useFakeTimers();
  try {
    state.brandId = brandId;
    state.pathname = "/dashboard/time";
    state.subscription = {
      status: "past_due",
      pastDueSince: new Date(Date.now() - days * 86_400_000).toISOString(),
    };
    const html = renderToString(
      <DashboardShell>
        <div>private-dashboard</div>
      </DashboardShell>,
    );
    expect(html.includes("private-dashboard")).toBe(access);
    expect(html.includes("subscription-wall")).toBe(!access);
  } finally {
    vi.useRealTimers();
  }
});
