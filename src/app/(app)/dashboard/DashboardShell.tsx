"use client";

import * as Sentry from "@sentry/nextjs";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Compass,
  HelpCircle,
  LogOut,
  Menu,
  MessageSquarePlus,
  Settings,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ImpersonationBanner } from "@/components/admin/ImpersonationBanner";
import { BrandLogo as Logo, useBrand } from "@/components/BrandContext";
import { AppDrawer } from "@/components/dashboard/AppDrawer";
import {
  bottomNavItems,
  goToShortcuts,
  isAclLoading,
  isNavItemVisible,
  mainNavGroups,
  mobileBottomNavItems,
  resolveEnterpriseMember,
  SidebarNavGroup,
  SidebarNavItem,
} from "@/components/dashboard-nav";
import { DemoBanner } from "@/components/demo/DemoBanner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ImportStatusBanner } from "@/components/ImportStatusBanner";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { OAuthSignupTracker } from "@/components/OAuthSignupTracker";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { OfflineBanner } from "@/components/offline/OfflineBanner";
import { OfflineQueueStatus } from "@/components/offline/OfflineQueueStatus";
import { TrialExpiredWall } from "@/components/subscription/TrialExpiredWall";
import { TimeTrackingBar } from "@/components/TimeTrackingBar";
import { QuickTimeEntryModal } from "@/components/time/QuickTimeEntryModal";
import { shouldAutoStartTour } from "@/components/tour/tour-gate";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { useOrgRole } from "@/hooks/useOrgRole";
import { isPastDueWithinGrace } from "@/lib/billing/plan-gate";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { OPEN_FEEDBACK_EVENT } from "@/lib/feedback/types";

// Lazy-loaded components not needed for initial render
const CommandPalette = dynamic(
  () =>
    import("@/components/CommandPalette").then((m) => ({
      default: m.CommandPalette,
    })),
  { ssr: false },
);
// Timer-first (#91): starter prøven i baggrunden og lander brugeren på Hjem.
// Den gamle wizard vises kun som sikkerhedsnet, hvis opstarten fejler.
const TimerFirstOnboarding = dynamic(
  () =>
    import("@/components/onboarding/TimerFirstOnboarding").then((m) => ({
      default: m.TimerFirstOnboarding,
    })),
  { ssr: false },
);
const GuidedTour = dynamic(
  () => import("@/components/tour").then((m) => ({ default: m.GuidedTour })),
  { ssr: false },
);
const PWARegistration = dynamic(
  () =>
    import("@/components/PWARegistration").then((m) => ({
      default: m.PWARegistration,
    })),
  { ssr: false },
);
const PWAInstallPrompt = dynamic(
  () =>
    import("@/components/PWAInstallPrompt").then((m) => ({
      default: m.PWAInstallPrompt,
    })),
  { ssr: false },
);
const TimerEnhancements = dynamic(
  () =>
    import("@/components/TimerEnhancements").then((m) => ({
      default: m.TimerEnhancements,
    })),
  { ssr: false },
);
const TimerRecoveryDialog = dynamic(
  () =>
    import("@/components/timer").then((m) => ({
      default: m.TimerRecoveryDialog,
    })),
  { ssr: false },
);
const FloatingTimerButton = dynamic(
  () =>
    import("@/components/timer").then((m) => ({
      default: m.FloatingTimerButton,
    })),
  { ssr: false },
);
const FeedbackPanel = dynamic(
  () =>
    import("@/components/feedback/FeedbackPanel").then((m) => ({
      default: m.FeedbackPanel,
    })),
  { ssr: false },
);
const CalendarReconnectBanner = dynamic(
  () =>
    import("@/components/calendar/CalendarReconnectBanner").then((m) => ({
      default: m.CalendarReconnectBanner,
    })),
  { ssr: false },
);
// ElectricSQL spike (issue #260) — beta-only live badge; renders nothing when
// the Electric proxy is disabled (prod).
const ElectricTimerDebug = dynamic(
  () =>
    import("@/components/ElectricTimerDebug").then((m) => ({
      default: m.ElectricTimerDebug,
    })),
  { ssr: false },
);

import { useTranslations } from "next-intl";
import { ChangelogDot, useHasUnseenChangelog } from "@/components/ChangelogDot";

const ChangelogModal = dynamic(
  () => import("@/components/ChangelogModal").then((mod) => mod.ChangelogModal),
  { ssr: false },
);

import { InboxBell } from "@/components/notifications/InboxBell";
import {
  useEnterpriseMemberHint,
  usePersistEnterpriseMemberHint,
} from "@/hooks/useEnterpriseMemberHint";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useModules } from "@/hooks/useModules";
import { signOut, useSession } from "@/lib/auth-client";
import { useElectricBadgeEnabled } from "@/lib/electric/badgePreference";
import {
  sessionRetryDelay,
  shouldSignOutForMissingSession,
} from "@/lib/pwa/session-guard";
import { trpc } from "@/providers/trpc-provider";
import { useTimerStore } from "@/stores/timerStore";
import { useTourStore } from "@/stores/tourStore";

// Admin link - only shown for admins
const adminNavItem = {
  name: "Admin",
  translationKey: "admin",
  href: "/dashboard/admin",
  icon: Shield,
};

// Loading fallback for Suspense boundary (required for useSearchParams)
function DashboardLayoutFallback() {
  const t = useTranslations("shell");
  return <LoadingScreen fullScreen message={t("loadingDashboard")} />;
}

// Export with Suspense wrapper to support useSearchParams during static generation
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<DashboardLayoutFallback />}>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </Suspense>
  );
}

// Separate component — only this re-renders every second when timer ticks
function FocusModeOverlay({
  focusMode,
  onExitFocus,
}: {
  focusMode: boolean;
  onExitFocus: () => void;
}) {
  const t = useTranslations("shell");
  const isRunning = useTimerStore((s) => s.isRunning);
  const elapsedTime = useTimerStore((s) => s.elapsedTime);
  const timerProjectId = useTimerStore((s) => s.projectId);
  const timerClientId = useTimerStore((s) => s.clientId);
  const timerDescription = useTimerStore((s) => s.description);

  if (!focusMode || !isRunning) return null;

  const h = Math.floor(elapsedTime / 3600);
  const m = Math.floor((elapsedTime % 3600) / 60);
  const s = Math.floor(elapsedTime % 60);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/95 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="text-6xl sm:text-8xl font-bold text-white tabular-nums tracking-wider">
          {`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`}
        </div>

        <div className="text-lg text-gray-400">
          {timerProjectId || timerClientId ? (
            <span className="text-gray-300">
              {timerProjectId && timerClientId
                ? `${timerClientId} → ${timerProjectId}`
                : timerProjectId || timerClientId || ""}
            </span>
          ) : (
            <span className="text-gray-500">{t("noProjectSelected")}</span>
          )}
        </div>

        {timerDescription && (
          <p className="text-xl text-gray-300 max-w-md">{timerDescription}</p>
        )}

        <button
          type="button"
          onClick={() => {
            onExitFocus();
            window.dispatchEvent(new CustomEvent("timer-stop-shortcut"));
          }}
          className="mt-4 rounded-xl bg-red-600 px-8 py-3 text-lg font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-950"
        >
          {t("stopAndSave")}
        </button>

        <p className="text-sm text-gray-600">
          {t.rich("focusExitHint", {
            kbd: (chunks) => (
              <kbd className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-400">
                {chunks}
              </kbd>
            ),
          })}
        </p>
      </div>
    </div>
  );
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const tNav = useTranslations("nav");
  const t = useTranslations("shell");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [quickTimeEntryOpen, setQuickTimeEntryOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const hasUnseenChangelog = useHasUnseenChangelog();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    data: session,
    isPending,
    error: sessionError,
    refetch: refetchSession,
  } = useSession();
  const isRunning = useTimerStore((s) => s.isRunning);
  const timerProjectId = useTimerStore((s) => s.projectId);
  const timerClientId = useTimerStore((s) => s.clientId);
  const timerDescription = useTimerStore((s) => s.description);
  const startTimer = useTimerStore((s) => s.startTimer);
  const startTime = useTimerStore((s) => s.startTime);
  const pauseTimer = useTimerStore((s) => s.pauseTimer);
  const resumeTimer = useTimerStore((s) => s.resumeTimer);
  const {
    isActive: tourActive,
    hasCompletedTour,
    startTour: startTourAction,
    resetTour,
  } = useTourStore();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sessionErrorRef = useRef(sessionError);
  sessionErrorRef.current = sessionError;
  const actionHandledRef = useRef(false);
  const { isEnabled } = useFeatureFlags();
  const {
    isEnabled: isModuleEnabled,
    isLoading: modulesLoading,
    isPlaceholder: modulesPlaceholder,
    isError: modulesError,
    orgProfile,
    teamSize,
  } = useModules();

  // Role-based module access (rolePermissions). Hide nav items the caller's
  // role has "none" access to. Optimistic (show) while loading.
  const { data: myPerms } = trpc.rolePermissions.getMyPermissions.useQuery(
    undefined,
    { staleTime: 60_000 },
  );
  // Effective org role (max of members.role / employeeProfiles.role) for
  // minRole/freelancerOnly nav gating. Role-gated items are HIDDEN until both
  // role and org profile are known, so enterprise members never see freelance
  // or manager items flash in before the real data arrives. A FAILED role
  // query ends the loading state (fail-open like RoleGuard — the server
  // enforces), so the nav never stays empty forever.
  const { data: myRoleData, isError: myRoleError } =
    trpc.rolePermissions.getMyRole.useQuery(undefined, {
      staleTime: 60_000,
      retry: 1,
    });
  const myRole = myRoleData?.role;
  const aclLoading = isAclLoading({
    modulesLoading,
    modulesPlaceholder,
    roleLoaded: !!myRoleData,
    roleError: myRoleError,
  });
  const { enabled: billingEnabled } = useBillingEnabled();
  // Global timer bar is a freelance affordance: enterprise members/managers
  // register in the weekly timesheet instead. Before real data arrives the
  // decision comes from a sticky per-browser hint, so freelancers never lose
  // the bar during load and known enterprise members never see it flash.
  const enterpriseMemberHint = useEnterpriseMemberHint();
  const modulesReady = !modulesLoading && !modulesPlaceholder && !modulesError;
  const { isMember: isEnterpriseMember, resolved: enterpriseMemberResolved } =
    resolveEnterpriseMember({
      orgProfile: modulesReady ? orgProfile : undefined,
      role: myRole,
      roleLoaded: !!myRoleData,
      hint: enterpriseMemberHint,
    });
  usePersistEnterpriseMemberHint(enterpriseMemberResolved, isEnterpriseMember);
  const showTimerBar = !isEnterpriseMember;
  const canAccessModule = useCallback(
    (permModule: string) => {
      if (!myPerms) return true;
      const p = myPerms.find((x) => x.moduleKey === permModule);
      return (p?.accessLevel ?? "write") !== "none";
    },
    [myPerms],
  );

  const filteredNavGroups = useMemo(() => {
    // While modules are loading, HIDE module-gated items instead of showing
    // them — otherwise enterprise users briefly see freelance nav before it
    // collapses. Feature-flag + module gating is unified via isNavItemVisible.
    return mainNavGroups
      .map((group) => ({
        ...group,
        // Enterprise-profil: freelance-overskrifter ("Kunder"/"Økonomi")
        // erstattes af neutrale ("Projekter"/"Rapporter").
        ...(orgProfile === "enterprise" && group.enterpriseLabel
          ? {
              label: group.enterpriseLabel,
              labelTranslationKey: group.enterpriseLabelTranslationKey,
            }
          : {}),
        items: group.items.filter((item) => {
          if (item.requiresModule && modulesLoading) return false;
          if ((item.minRole || item.freelancerOnly) && aclLoading) return false;
          return isNavItemVisible(item, {
            isFlagEnabled: isEnabled,
            isModuleEnabled,
            canAccessModule,
            role: myRole,
            teamSize,
            orgProfile,
          });
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [
    isEnabled,
    isModuleEnabled,
    modulesLoading,
    canAccessModule,
    aclLoading,
    myRole,
    orgProfile,
    teamSize,
  ]);

  const visibleBottomNavItems = useMemo(
    () =>
      bottomNavItems.filter((item) => {
        if (item.requiresModule && modulesLoading) return false;
        if ((item.minRole || item.freelancerOnly) && aclLoading) return false;
        return isNavItemVisible(item, {
          isFlagEnabled: isEnabled,
          isModuleEnabled,
          canAccessModule,
          role: myRole,
          teamSize,
          orgProfile,
        });
      }),
    [
      isEnabled,
      isModuleEnabled,
      modulesLoading,
      canAccessModule,
      aclLoading,
      myRole,
      orgProfile,
      teamSize,
    ],
  );

  // Kun ét bundpunkt er aktivt: på /dashboard/organization/permissions er det
  // Adgangsstyring, ikke også Organisation (længste matchende href vinder).
  const activeBottomNavHref = useMemo(
    () =>
      visibleBottomNavItems
        .map((item) => item.href)
        .filter((href) => pathname === href || pathname?.startsWith(`${href}/`))
        .sort((a, b) => b.length - a.length)[0],
    [visibleBottomNavItems, pathname],
  );

  // Console-ringbuffer til feedback-panelets fejlrapporter (bugbottle).
  // Client-only: den patcher den console, den finder — på serveren serverens.
  useEffect(() => {
    import("bugbottle").then((m) => m.initConsoleBuffer());
  }, []);

  // Identify user in Sentry for error context
  useEffect(() => {
    if (session?.user) {
      Sentry.setUser({
        id: session.user.id,
        email: session.user.email || undefined,
      });
    } else {
      Sentry.setUser(null);
    }
  }, [session?.user]);

  // Load sidebar state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebar-collapsed");
      if (saved !== null) {
        setSidebarCollapsed(JSON.parse(saved));
      }
    } catch {
      // Ignore corrupted localStorage values
    }
  }, []);

  // Auto-close mobile sidebar on navigation
  useEffect(() => {
    setSidebarOpen(false);
  }, []);

  // Save sidebar state to localStorage
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const newState = !prev;
      localStorage.setItem("sidebar-collapsed", JSON.stringify(newState));
      return newState;
    });
  }, []);

  // Check if user needs onboarding
  const { data: userProfile, isLoading: profileLoading } =
    trpc.user.getProfile.useQuery(undefined, {
      enabled: !!session?.user,
    });
  const electricBadgeEnabled = useElectricBadgeEnabled();

  // Subscription check for trial gating
  const { data: subscription, isLoading: subLoading } =
    trpc.subscription.getDetails.useQuery(undefined, {
      enabled: !!session?.user,
    });

  // Dismissed banner state (session-only via state, not localStorage to keep simple)
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false);
  const [pastDueBannerDismissed, setPastDueBannerDismissed] = useState(false);

  const [orgSwitching, setOrgSwitching] = useState(false);
  const sessionNullCount = useRef(0);

  useEffect(() => {
    const onStart = () => setOrgSwitching(true);
    const onEnd = () => setOrgSwitching(false);
    window.addEventListener("org-switch-start", onStart);
    window.addEventListener("org-switch-end", onEnd);
    return () => {
      window.removeEventListener("org-switch-start", onStart);
      window.removeEventListener("org-switch-end", onEnd);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: sessionError er en udløser: sessiontjekket skal genkøre, når sessionkaldet fejler eller lykkes igen
  useEffect(() => {
    if (isPending || orgSwitching) {
      sessionNullCount.current = 0;
      return;
    }

    if (!session) {
      // Uden net (koldstart i den installerede app) eller ved netværks-/
      // serverfejl er sessionen ukendt, ikke udløbet: log ikke ud.
      const mayLogOut = () =>
        shouldSignOutForMissingSession({
          online: navigator.onLine !== false,
          errorStatus: sessionErrorRef.current?.status,
          hasError: !!sessionErrorRef.current,
        });
      if (!mayLogOut()) {
        sessionNullCount.current = 0;
        return;
      }
      // Session can be transiently null during org switch or cookie refresh.
      // Only sign out after TWO consecutive null checks (debounce).
      sessionNullCount.current++;
      if (sessionNullCount.current < 2) {
        const timer = setTimeout(() => {
          // Re-check — if still no session after 1.5s, it's a real logout
          if (!sessionRef.current && mayLogOut()) {
            signOut().then(() => router.push("/login"));
          }
        }, 1500);
        return () => clearTimeout(timer);
      }
      signOut().then(() => router.push("/login"));
      return;
    }

    sessionNullCount.current = 0;
  }, [session, sessionError, isPending, orgSwitching, router]);

  // Sessionskaldet fejlede (fx 502 under deploy): prøv igen med backoff.
  const [sessionRetries, setSessionRetries] = useState(0);
  useEffect(() => {
    if (session || !sessionError) {
      setSessionRetries(0);
      return;
    }
    if (navigator.onLine === false) return;
    const timer = setTimeout(() => {
      setSessionRetries((n) => n + 1);
      void refetchSession();
    }, sessionRetryDelay(sessionRetries));
    return () => clearTimeout(timer);
  }, [session, sessionError, sessionRetries, refetchSession]);

  // Sessionen blev ikke hentet uden net — hent den, når nettet er tilbage.
  useEffect(() => {
    const onOnline = () => {
      if (!sessionRef.current) void refetchSession();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [refetchSession]);

  // CMD+K / CTRL+K keyboard shortcut for command palette + Escape for focus mode
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
      }
      if (e.key === "Escape" && focusMode) {
        e.preventDefault();
        setFocusMode(false);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [focusMode]);

  // Listen for quick time entry open event (from CommandPalette)
  useEffect(() => {
    const handleOpen = () => setQuickTimeEntryOpen(true);
    window.addEventListener("open-quick-time-entry", handleOpen);
    return () =>
      window.removeEventListener("open-quick-time-entry", handleOpen);
  }, []);

  // Auto-disable focus mode when timer stops
  useEffect(() => {
    if (!isRunning && focusMode) {
      setFocusMode(false);
    }
  }, [isRunning, focusMode]);

  // Reset action handler when action param changes
  useEffect(() => {
    const action = searchParams.get("action");
    if (action) {
      actionHandledRef.current = false;
    }
  }, [searchParams]);

  // Handle protocol handler actions (web+timetrack://action)
  useEffect(() => {
    if (!session || isPending || actionHandledRef.current) return;

    const action = searchParams.get("action");
    if (!action) return;

    // Mark action as handled to prevent repeated triggers
    actionHandledRef.current = true;

    // Handle different action types
    switch (action) {
      case "start-timer":
      case "timer/start":
        startTimer({
          clientId: timerClientId,
          projectId: timerProjectId,
          description: timerDescription,
        });
        toast.success(t("timerStarted"), {
          description: t("timerStartedFromLink"),
        });
        break;

      case "new-time-entry":
      case "time/new":
        router.push("/dashboard/time/new");
        break;

      case "new-client":
      case "clients/new":
        router.push("/dashboard/clients/new");
        break;

      case "new-project":
      case "projects/new":
        router.push("/dashboard/projects/new");
        break;

      default:
        console.warn("[Protocol Handler] Unknown action:", action);
    }

    // Clean up URL after handling (optional, prevents re-trigger on refresh)
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    window.history.replaceState({}, "", url.toString());
  }, [
    session,
    isPending,
    searchParams,
    startTimer,
    timerProjectId,
    timerClientId,
    timerDescription,
    router,
    t,
  ]);

  // Timer keyboard shortcuts (T = start/stop, Shift+T = pause/resume)

  // Track 'g' key for go-to shortcuts (g+c, g+p, g+t)
  const [gKeyPressed, setGKeyPressed] = useState(false);

  // Global keyboard shortcuts
  useEffect(() => {
    let gKeyTimeout: NodeJS.Timeout | null = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea or if command palette is open
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        commandPaletteOpen
      ) {
        return;
      }

      // Handle 'g' key for go-to shortcuts
      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!gKeyPressed) {
          setGKeyPressed(true);
          // Reset after 1.5 seconds if no second key pressed
          gKeyTimeout = setTimeout(() => setGKeyPressed(false), 1500);
        }
        return;
      }

      // Handle second key after 'g' for go-to navigation
      if (gKeyPressed) {
        e.preventDefault();
        setGKeyPressed(false);
        if (gKeyTimeout) clearTimeout(gKeyTimeout);

        // Fælles tabel med kommandopaletten (goToShortcuts)
        const shortcut = goToShortcuts.find(
          (s) => s.key === e.key.toLowerCase(),
        );
        if (shortcut) {
          router.push(shortcut.href);
          toast.info(
            t("navigatingTo", {
              label: shortcut.labelKey
                ? tNav(shortcut.labelKey)
                : shortcut.label,
              key: shortcut.key.toUpperCase(),
            }),
          );
        }
        return;
      }

      // Handle 'n' key for new/create actions (context-aware)
      if (
        e.key === "n" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        // Navigate based on current page
        if (pathname?.includes("/clients")) {
          router.push("/dashboard/clients/new");
          toast.info(t("newClientToast"));
        } else if (pathname?.includes("/projects")) {
          router.push("/dashboard/projects/new");
          toast.info(t("newProjectToast"));
        } else if (pathname?.includes("/time")) {
          router.push("/dashboard/time/new");
          toast.info(t("newTimeEntryToast"));
        } else if (pathname?.includes("/klippekort")) {
          router.push("/dashboard/klippekort/new");
          toast.info(t("newPrepaidToast"));
        } else if (pathname?.includes("/invoices")) {
          router.push("/dashboard/invoices/new");
          toast.info(t("newInvoiceToast"));
        } else if (pathname?.includes("/templates")) {
          router.push("/dashboard/templates/new");
          toast.info(t("newTemplateToast"));
        } else {
          // Default: open command palette
          setCommandPaletteOpen(true);
        }
        return;
      }

      // Handle '/' for search focus
      if (e.key === "/" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        // Focus the first search input on the page
        const searchInput = document.querySelector(
          'input[type="text"][placeholder*="Søg"], input[type="text"][placeholder*="Search"], input[type="text"][placeholder*="Such"], input[type="text"][placeholder*="Buscar"], input[type="search"]',
        ) as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
          toast.info(t("searchFocusedToast"));
        }
        return;
      }

      // Handle '?' for keyboard shortcuts help
      if (e.key === "?" && e.shiftKey) {
        e.preventDefault();
        // Dispatch event for help modal
        window.dispatchEvent(new CustomEvent("show-keyboard-shortcuts"));
        return;
      }

      // Handle 'f' for focus mode toggle (only when timer is running)
      if (
        e.key === "f" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        if (isRunning) {
          e.preventDefault();
          setFocusMode((prev) => !prev);
          return;
        }
      }

      // Handle 't' or 'T' for timer shortcuts
      if (e.key !== "t" && e.key !== "T") return;

      e.preventDefault();

      if (e.shiftKey) {
        // Shift+T = Pause/Resume
        if (isRunning) {
          pauseTimer();
          toast.info(t("timerPausedToast"));
        } else if (startTime) {
          // Has startTime but not running = paused
          resumeTimer();
          toast.info(t("timerResumedToast"));
        }
      } else {
        // T = Start/Stop
        if (isRunning) {
          // Timer is running - dispatch event to stop and save (will require project)
          window.dispatchEvent(new CustomEvent("timer-stop-shortcut"));
        } else {
          // Timer is not running - start immediately (project can be selected later)
          window.dispatchEvent(new CustomEvent("timer-start-shortcut"));
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (gKeyTimeout) clearTimeout(gKeyTimeout);
    };
  }, [
    isRunning,
    startTime,
    pauseTimer,
    resumeTimer,
    commandPaletteOpen,
    gKeyPressed,
    router,
    pathname,
    t,
    tNav,
  ]);

  // handleSignOut must be defined before conditional returns (Rules of Hooks)
  const handleSignOut = useCallback(async () => {
    await signOut();
    router.push("/login");
  }, [router]);

  // Show onboarding modal if not completed (computed before hooks that depend on it)
  const showOnboardingModal =
    userProfile && !userProfile.onboardingCompleted && !!session;

  // Persist the guided-tour "seen" flag server-side (localStorage's
  // hasCompletedTour doesn't survive an origin change, e.g. the
  // timetrack.dk → app.timetrack.dk split, so the tour would re-trigger).
  const dismissBannerMutation = trpc.user.dismissBanner.useMutation();
  const tourDismissPersistedRef = useRef(false);
  const tourServerSeen = userProfile?.dismissedBanners?.includes("guided-tour");
  useEffect(() => {
    if (
      hasCompletedTour &&
      !tourServerSeen &&
      !tourDismissPersistedRef.current
    ) {
      tourDismissPersistedRef.current = true;
      dismissBannerMutation.mutate({ key: "guided-tour" });
    }
  }, [hasCompletedTour, tourServerSeen, dismissBannerMutation]);

  // Auto-start guided tour after onboarding completion. Gated on BOTH the
  // local flag and the server-side dismissal so a returning user who already
  // saw the tour (on the old origin) never gets it again. Also gated on org
  // role: invited members don't get the owner tour (#426).
  const { role: tourOrgRole, isResolved: tourOrgRoleResolved } = useOrgRole();
  const tourStartedRef = useRef(false);
  useEffect(() => {
    if (
      tourStartedRef.current ||
      !shouldAutoStartTour({
        onboardingCompleted: userProfile?.onboardingCompleted === true,
        hasCompletedTour,
        tourServerSeen: tourServerSeen === true,
        tourActive,
        showOnboardingModal: showOnboardingModal === true,
        // Only a real server answer counts: the hook falls back to "owner"
        // while loading or on error, which must not start the tour.
        orgRole: tourOrgRoleResolved ? tourOrgRole : undefined,
        demo: isDemoMode(),
      })
    ) {
      return;
    }
    tourStartedRef.current = true;
    const timeout = setTimeout(() => startTourAction(), 500);
    return () => clearTimeout(timeout);
  }, [
    userProfile?.onboardingCompleted,
    hasCompletedTour,
    tourServerSeen,
    tourActive,
    showOnboardingModal,
    startTourAction,
    tourOrgRole,
    tourOrgRoleResolved,
  ]);

  // Force sidebar expanded + open on mobile during tour
  const preTourCollapsedRef = useRef<boolean | null>(null);
  // Knapperne, fokus skal tilbage til, når feedbackpanelet lukkes. Panelet
  // husker det element, der havde fokus ved åbning, og menupunktet forsvinder
  // med menuen. Derfor flyttes fokus til en knap, der bliver stående, før
  // panelet åbnes.
  const mobileUserMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavButtonRef = useRef<HTMLButtonElement>(null);
  const openFeedbackFrom = (returnTo: HTMLElement | null) => {
    setUserMenuOpen(false);
    setSidebarOpen(false);
    returnTo?.focus();
    window.dispatchEvent(new Event(OPEN_FEEDBACK_EVENT));
  };
  useEffect(() => {
    if (tourActive) {
      // Save pre-tour state and expand
      if (sidebarCollapsed) {
        preTourCollapsedRef.current = true;
        setSidebarCollapsed(false);
      }
      // Open mobile sidebar for sidebar-targeting steps
      const isMobile = window.innerWidth < 1024;
      if (isMobile) {
        setSidebarOpen(true);
      }
    } else if (preTourCollapsedRef.current === true) {
      // Restore collapsed state after tour
      setSidebarCollapsed(true);
      preTourCollapsedRef.current = null;
    }
  }, [tourActive, sidebarCollapsed]);

  // Show loading while checking session
  if (isPending) {
    return <LoadingScreen fullScreen message={t("loading")} showTip={false} />;
  }

  // Sessionen kunne ikke hentes (net- eller serverfejl): vis det i stedet
  // for en blank side. Automatiske genforsøg kører ovenfor.
  if (!session && sessionError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          {t("connectionFailedTitle", { brand: brand.name })}
        </h1>
        <p className="max-w-md text-sm text-gray-600 dark:text-gray-400">
          {t("connectionFailedBody")}
        </p>
        <button
          type="button"
          onClick={() => void refetchSession()}
          className="rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  // Don't render dashboard if no session
  if (!session) {
    return null;
  }

  // Subscription gating — block access for expired trials, canceled, and past_due > 7 days.
  // Gratis-tier ("free") has access; its limits are enforced server-side.
  // TimeWren matches its server gate. TimeTrack retains its rounded-day grace.
  const withinPaymentGrace =
    brand.id === "timewren"
      ? isPastDueWithinGrace(subscription)
      : subscription?.status === "past_due" &&
        (!subscription.pastDueSince ||
          Date.now() - new Date(subscription.pastDueSince).getTime() <
            8 * 86_400_000);

  // Medlem nr. 4+ i en org på Gratis er låst (subscription.getDetails).
  const hasAccess =
    subLoading ||
    !billingEnabled ||
    (subscription &&
      !subscription.memberLocked &&
      (subscription.status === "active" ||
        subscription.status === "free" ||
        subscription.status === "canceled" ||
        withinPaymentGrace ||
        (subscription.status === "trialing" && !subscription.isTrialExpired)));

  const isOnboardingPath = pathname?.startsWith("/dashboard/onboarding");
  const isExemptPath =
    pathname === "/dashboard/my-records" ||
    pathname?.startsWith("/dashboard/settings/subscription") ||
    pathname?.startsWith("/dashboard/settings/data") ||
    isOnboardingPath;

  const onboarding = showOnboardingModal && !isOnboardingPath && (
    <TimerFirstOnboarding />
  );

  // Keep onboarding mounted while it provisions the plan required by writes.
  if (
    billingEnabled &&
    !subscription &&
    !isOnboardingPath &&
    (profileLoading || showOnboardingModal)
  ) {
    const loading = (
      <LoadingScreen fullScreen message={t("loading")} showTip={false} />
    );
    return showOnboardingModal ? (
      <TimerFirstOnboarding loadingFallback={loading} />
    ) : (
      loading
    );
  }

  if (!hasAccess && !isExemptPath && !showOnboardingModal) {
    return <TrialExpiredWall subscription={subscription ?? null} />;
  }

  // Warning banners
  const showTrialWarning =
    billingEnabled &&
    !trialBannerDismissed &&
    subscription?.status === "trialing" &&
    !subscription.isTrialExpired &&
    subscription.trialDaysRemaining <= 7;

  const showPastDueWarning =
    billingEnabled &&
    !pastDueBannerDismissed &&
    subscription?.status === "past_due";

  const dashboard = (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Impersonation banner — only renders when admin plugin's
          session.impersonatedBy is set on the current session. */}
      <ImpersonationBanner />
      {/* Offentlig demo (DEMO_MODE=1): fast, smal bjælke på alle sider */}
      <DemoBanner />

      {/* PWA Components - Service Worker Registration & Install Prompt */}
      <PWARegistration />
      <PWAInstallPrompt />

      {/* Signup-konvertering for OAuth-signups (?signup=oauth) */}
      <OAuthSignupTracker />

      {/* Timer Enhancements - Idle Detection, Wake Lock, Badging */}
      <TimerEnhancements />

      {/* ElectricSQL-debugbadge (#260): Electric kører også i prod, så kun
          platform-admins ser den, og kun når de har slået den til under
          Admin > Indstillinger. */}
      {userProfile?.role === "admin" && electricBadgeEnabled && (
        <ElectricTimerDebug />
      )}

      {/* Guided Tour - shows after onboarding completion */}
      {tourActive && <GuidedTour />}

      {/* Command Palette */}
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        navGroups={filteredNavGroups}
        bottomNavItems={visibleBottomNavItems}
      />

      {/* What's New Modal — auto-opens on unseen changelogs, or via menu.
          Monteres kun når der er noget at vise, så modalens chunk (markdown +
          sanitize-html) ikke hentes ved hver indlæsning. */}
      {(showChangelog || hasUnseenChangelog) && (
        <ChangelogModal
          forceOpen={showChangelog}
          onClose={() => setShowChangelog(false)}
        />
      )}

      {/* Keyboard Shortcuts Help Modal */}
      <KeyboardShortcutsModal />

      {/* Quick Time Entry Modal */}
      <QuickTimeEntryModal
        isOpen={quickTimeEntryOpen}
        onClose={() => setQuickTimeEntryOpen(false)}
      />

      {/* Timer Recovery Dialog - shows if timer was running when browser closed */}
      <TimerRecoveryDialog />

      {/* Floating Action Button - mobile only */}
      <FloatingTimerButton />

      {/* Feedback-panel (bugbottle) — knappen står over timer-knappen på desktop */}
      {session?.user?.id && <FeedbackPanel userId={session.user.id} />}

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-gray-900/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") {
              setSidebarOpen(false);
            }
          }}
          aria-label={t("closeSidebar")}
        />
      )}

      {/* User menu backdrop. Under topbaren (sticky z-10): topbarens menu
          ligger i headerens stacking-kontekst, så en z-50-backdrop her dækkede
          menuen, og et tryk på et menupunkt lukkede bare menuen på mobil. */}
      {userMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-[5] bg-transparent"
          onClick={() => setUserMenuOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") {
              setUserMenuOpen(false);
            }
          }}
          aria-label={t("closeUserMenu")}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform bg-white dark:bg-gray-900 shadow-lg transition-all duration-300 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${sidebarCollapsed ? "w-20" : "w-64"}`}
      >
        <div className="flex h-full flex-col">
          {/* Logo + collapse toggle */}
          <div
            className={`flex h-14 items-center border-b border-gray-200 dark:border-gray-800 ${sidebarCollapsed ? "justify-center px-4" : "justify-between px-6"}`}
          >
            {/* aria-label kun når logoet ikke selv har synlig tekst (collapsed):
                ellers indeholder den tilgængelige navn ikke den synlige tekst
                "TimeTrack" (axe: label-content-name-mismatch). */}
            <Link
              href="/dashboard"
              aria-label={sidebarCollapsed ? t("goHome") : undefined}
            >
              {sidebarCollapsed ? (
                <Logo size="lg" showText={false} />
              ) : (
                <Logo size="md" />
              )}
            </Link>
            {!sidebarCollapsed && (
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={t("collapseMenu")}
                className="rounded-md p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                title={t("collapseMenu")}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Navigation */}
          <nav
            aria-label={t("mainNavigation")}
            className="flex-1 overflow-y-auto px-3 py-2"
          >
            <div className="space-y-2">
              {filteredNavGroups.map((group) => (
                <SidebarNavGroup
                  key={group.label || "main"}
                  group={group}
                  collapsed={sidebarCollapsed}
                  pathname={pathname}
                  onNavigate={() => setSidebarOpen(false)}
                />
              ))}
            </div>

            {/* Admin link - for admins and supporters */}
            {(userProfile?.role === "admin" ||
              userProfile?.role === "supporter") && (
              <>
                <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
                <SidebarNavItem
                  item={adminNavItem}
                  collapsed={sidebarCollapsed}
                  isActive={pathname?.startsWith("/dashboard/admin") ?? false}
                  onNavigate={() => setSidebarOpen(false)}
                  variant="admin"
                />
              </>
            )}
          </nav>

          {/* Bottom-pinned navigation */}
          {visibleBottomNavItems.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-2 space-y-0.5">
              {visibleBottomNavItems.map((item) => (
                <SidebarNavItem
                  key={item.href}
                  item={item}
                  collapsed={sidebarCollapsed}
                  isActive={item.href === activeBottomNavHref}
                  onNavigate={() => setSidebarOpen(false)}
                />
              ))}
            </div>
          )}

          {/* Expand button (only when collapsed) */}
          {sidebarCollapsed && (
            <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-2">
              <button
                type="button"
                onClick={toggleSidebar}
                aria-label={t("expandMenu")}
                className="flex w-full items-center justify-center rounded-lg p-2 text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                title={t("expandMenu")}
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          )}

          {/* In-app-notifikationer (E10, #468) — kun enterprise */}
          <InboxBell collapsed={sidebarCollapsed} />

          {/* Org switcher */}
          <OrgSwitcher collapsed={sidebarCollapsed} />

          {/* User menu */}
          <div className="border-t border-gray-200 dark:border-gray-800 p-4">
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                title={
                  sidebarCollapsed
                    ? session?.user.name || t("userFallback")
                    : undefined
                }
                className={`flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 ${sidebarCollapsed ? "justify-center" : "gap-3"}`}
              >
                {/* sr-only i stedet for aria-label på knappen: ellers
                    indeholder det tilgængelige navn ikke navn/mail-teksten,
                    der vises når sidebaren ikke er collapsed (axe:
                    label-content-name-mismatch). */}
                <span className="sr-only">{t("openUserMenu")}</span>
                <UserAvatar
                  name={session?.user.name}
                  image={session?.user.image}
                  size="sm"
                  fallbackClassName="bg-brand-100 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400"
                />
                {!sidebarCollapsed && (
                  <>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {session?.user.name || t("userFallback")}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {session?.user.email}
                      </p>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  </>
                )}
              </button>

              {userMenuOpen && (
                <div
                  role="menu"
                  aria-label={t("userMenu")}
                  className={`fixed bottom-4 z-[60] mb-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg ${
                    sidebarCollapsed
                      ? "left-4 w-48"
                      : "left-4 right-4 max-w-[240px]"
                  }`}
                >
                  {sidebarCollapsed && (
                    <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {session?.user.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {session?.user.email}
                      </p>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setSidebarOpen(false);
                      resetTour();
                      setTimeout(() => startTourAction(), 300);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-t-lg"
                  >
                    <Compass className="h-4 w-4 shrink-0" />
                    <span>{t("startTour")}</span>
                  </button>
                  <Link
                    href="/dashboard/help"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setSidebarOpen(false);
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <HelpCircle className="h-4 w-4 shrink-0" />
                    <span>{t("help")}</span>
                  </Link>
                  {/* Kun under lg: på desktop har panelet sin egen knap.
                      Sidemenuen lukker, så fokus vender tilbage til knappen,
                      der åbnede den. */}
                  <button
                    type="button"
                    onClick={() => openFeedbackFrom(mobileNavButtonRef.current)}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 lg:hidden"
                  >
                    <MessageSquarePlus className="h-4 w-4 shrink-0" />
                    <span>{t("sendFeedback")}</span>
                  </button>
                  {/* Ingen "Nyheder" i den offentlige demo (#1213) */}
                  {!isDemoMode() && (
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        setSidebarOpen(false);
                        setShowChangelog(true);
                      }}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 w-full text-left"
                    >
                      <div className="relative">
                        <Sparkles className="h-4 w-4 shrink-0" />
                        <ChangelogDot />
                      </div>
                      <span>{t("whatsNew")}</span>
                    </button>
                  )}
                  <Link
                    href="/dashboard/settings"
                    onClick={() => {
                      setUserMenuOpen(false);
                      setSidebarOpen(false);
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Settings className="h-4 w-4 shrink-0" />
                    <span>{tNav("settings")}</span>
                  </Link>
                  <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      handleSignOut();
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-b-lg"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    <span>{t("signOut")}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div
        className={`transition-all duration-300 ${sidebarCollapsed ? "lg:pl-20" : "lg:pl-64"}`}
      >
        {/* Top bar with integrated time tracking */}
        <div
          data-testid="dashboard-topbar"
          className="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm"
        >
          <div className="flex h-14 items-center gap-2 sm:gap-3 md:gap-4 px-2 sm:px-4 md:px-6 lg:px-8">
            {/* Mobile menu button */}
            <button
              ref={mobileNavButtonRef}
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label={t("openNavigation")}
              className="rounded-lg p-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 lg:hidden shrink-0"
            >
              <Menu className="h-5 w-5 sm:h-6 sm:w-6" />
            </button>

            {/* Time Tracking Bar - integrated */}
            <div
              className="flex-1 min-w-0 overflow-visible"
              data-tour="time-tracking-bar"
            >
              {showTimerBar && <TimeTrackingBar />}
            </div>

            {/* Offline-kø (#703): status + afspilning ved reconnect */}
            <OfflineQueueStatus />

            {/* Apps: Desktop, Chrome-udvidelse, PWA */}
            <AppDrawer />

            {/* Mobile user menu button */}
            <div className="lg:hidden shrink-0">
              <button
                ref={mobileUserMenuButtonRef}
                type="button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                aria-label={t("openUserMenu")}
                aria-expanded={userMenuOpen}
                aria-haspopup="menu"
                className="flex items-center justify-center rounded-lg p-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <UserAvatar
                  name={session?.user.name}
                  image={session?.user.image}
                  size="sm"
                  fallbackClassName="bg-brand-100 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400"
                />
              </button>

              {/* Samme state som sidemenuens brugermenu: er sidemenuen
                  åben, er det dens menu, der skal vises, ikke også denne */}
              {userMenuOpen && !sidebarOpen && (
                <div
                  role="menu"
                  aria-label={t("userMenu")}
                  className="fixed right-4 top-20 z-[60] w-56 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg"
                >
                  <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {session?.user.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {session?.user.email}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      resetTour();
                      setTimeout(() => startTourAction(), 300);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Compass className="h-4 w-4 shrink-0" />
                    <span>{t("startTour")}</span>
                  </button>
                  <Link
                    href="/dashboard/help"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <HelpCircle className="h-4 w-4 shrink-0" />
                    <span>{t("help")}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      openFeedbackFrom(mobileUserMenuButtonRef.current)
                    }
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <MessageSquarePlus className="h-4 w-4 shrink-0" />
                    <span>{t("sendFeedback")}</span>
                  </button>
                  <Link
                    href="/dashboard/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <Settings className="h-4 w-4 shrink-0" />
                    <span>{tNav("settings")}</span>
                  </Link>
                  <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      handleSignOut();
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-b-lg"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    <span>{t("signOut")}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <OfflineBanner />

        {/* Subscription warning banners */}
        {showTrialWarning && (
          <div className="border-b border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/50">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
              <div className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {t.rich("trialExpires", {
                    count: subscription?.trialDaysRemaining ?? 0,
                    link: (chunks) => (
                      <Link
                        href="/dashboard/settings/subscription"
                        className="font-medium underline hover:no-underline"
                      >
                        {chunks}
                      </Link>
                    ),
                  })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTrialBannerDismissed(true)}
                className="shrink-0 rounded p-1 text-yellow-600 hover:bg-yellow-100 dark:text-yellow-400 dark:hover:bg-yellow-900/50"
                aria-label={t("closeWarning")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        {showPastDueWarning && (
          <div className="border-b border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/50">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
              <div className="flex items-center gap-2 text-sm text-red-800 dark:text-red-200">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {t.rich("pastDue", {
                    link: (chunks) => (
                      <Link
                        href="/dashboard/settings/subscription"
                        className="font-medium underline hover:no-underline"
                      >
                        {chunks}
                      </Link>
                    ),
                  })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPastDueBannerDismissed(true)}
                className="shrink-0 rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/50"
                aria-label={t("closeWarning")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Calendar reconnect banner */}
        <div className="px-3 pt-3 sm:px-4 sm:pt-4 md:px-5 md:pt-0 lg:px-6">
          <CalendarReconnectBanner />
        </div>

        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
        >
          {t("skipToContent")}
        </a>

        {/* Page content — add bottom padding on mobile for the bottom nav */}
        <main
          id="main-content"
          className="p-3 sm:p-4 md:p-5 lg:p-6 pb-40 lg:pb-6"
        >
          <div className="mb-3 empty:hidden">
            <ImportStatusBanner />
          </div>
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label={t("mobileNavigation")}
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 lg:hidden"
      >
        <div className="flex items-center justify-around h-14">
          {mobileBottomNavItems
            .filter((item) => {
              if (item.requiresModule && modulesLoading) return false;
              if ((item.minRole || item.freelancerOnly) && aclLoading) {
                return false;
              }
              return isNavItemVisible(item, {
                isFlagEnabled: isEnabled,
                isModuleEnabled,
                canAccessModule,
                role: myRole,
                teamSize,
                orgProfile,
              });
            })
            .map((item) => {
              const isActive =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : (pathname?.startsWith(item.href) ?? false);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded-lg min-w-[4rem] transition-colors ${
                    isActive
                      ? "text-brand-600 dark:text-brand-400"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  <span className="relative">
                    <Icon className="h-5 w-5" />
                    {/* Active timer indicator on "Tid" */}
                    {item.href === "/dashboard/time" && isRunning && (
                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500 ring-2 ring-white dark:ring-gray-900" />
                    )}
                  </span>
                  <span className="text-[10px] font-medium leading-tight">
                    {item.translationKey
                      ? tNav(item.translationKey)
                      : item.name}
                  </span>
                </Link>
              );
            })}
        </div>
      </nav>

      {/* Focus Mode Overlay — separate component to avoid re-rendering layout every second */}
      <FocusModeOverlay
        focusMode={focusMode}
        onExitFocus={() => setFocusMode(false)}
      />
    </div>
  );

  return (
    <>
      {onboarding}
      {dashboard}
    </>
  );
}
