import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { deriveWebAppUrl } from "../config";
import { useTheme } from "../hooks/useTheme";
import { useT } from "../i18n";
import { invalidateEntryQueries } from "../lib/query-invalidation";
import { LoginPrompt } from "../popup/components/LoginPrompt";
import { OrgSwitcher } from "../popup/components/OrgSwitcher";
import { TimerErrorBanner } from "../popup/components/TimerErrorBanner";
import { useAuthStore } from "../stores/authStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTimerStore } from "../stores/timerStore";
import { StatsBar } from "./components/StatsBar";
import {
  NEWTAB_TABPANEL_ID,
  type NewTabTab,
  newTabTabId,
  TopBar,
} from "./components/TopBar";
import { CalendarTab } from "./components/tabs/CalendarTab";

// Kalenderen er den fane, ny fane åbner på; de andre faner og
// indstillingerne hentes først, når de åbnes.
const NewTabSettings = lazy(() =>
  import("./components/NewTabSettings").then((m) => ({
    default: m.NewTabSettings,
  })),
);
const DashboardTab = lazy(() =>
  import("./components/tabs/DashboardTab").then((m) => ({
    default: m.DashboardTab,
  })),
);
const HistoryTab = lazy(() =>
  import("./components/tabs/HistoryTab").then((m) => ({
    default: m.HistoryTab,
  })),
);
const PrepaidTab = lazy(() =>
  import("./components/tabs/PrepaidTab").then((m) => ({
    default: m.PrepaidTab,
  })),
);

export default function App() {
  const { t } = useT();
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const { settings, loadSettings } = useSettingsStore();
  const fetchTimerState = useTimerStore((s) => s.fetchTimerState);
  const lastStopResult = useTimerStore((s) => s.lastStopResult);
  const queryClient = useQueryClient();
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<NewTabTab>("calendar");
  const webAppUrl = deriveWebAppUrl(settings.apiUrl);

  // Initialize theme
  useTheme();

  useEffect(() => {
    checkAuth();
    loadSettings();
  }, [checkAuth, loadSettings]);

  // Fetch timer state when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchTimerState();
    }
  }, [isAuthenticated, fetchTimerState]);

  // Et stop fra chippen i toppen (eller Timer-widgeten): kalender, stats og
  // klippekort-saldo skal vise den gemte tid med det samme.
  useEffect(() => {
    if (lastStopResult) invalidateEntryQueries(queryClient);
  }, [lastStopResult, queryClient]);

  // En ny fane kan ligge åben i timevis. Hent timeren igen, når fanen bliver
  // synlig/får fokus, og når baggrunden melder en ændring — ellers viser den
  // en timer, som en anden enhed for længst har stoppet eller skiftet. Det
  // sker stille: ingen spinner og intet fejlbanner ved hvert fokus.
  useEffect(() => {
    if (!isAuthenticated) return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        fetchTimerState({ background: true });
      }
    };
    const handleMessage = (message: { type?: string }) => {
      if (message?.type === "TIMER_STATE_UPDATED") refreshIfVisible();
    };
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [isAuthenticated, fetchTimerState]);

  // New tab disabled: stay out of the way. Render an almost-blank page that
  // feels like a normal new tab — no logo/splash — with only a small, muted
  // control in the corner to re-open TimeTrack or re-enable the dashboard.
  // (A manifest newtab override can't hand control back to the browser's
  // native page, so "blank and unobtrusive" is the closest we can get.)
  if (!settings.newTabEnabled && !isLoading) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-base)]">
        <div className="fixed bottom-4 right-4 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
          <a
            href={`${webAppUrl}/dashboard`}
            className="hover:text-[var(--color-text-secondary)] transition-colors"
          >
            {t("newtab.openApp")}
          </a>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="hover:text-[var(--color-text-secondary)] transition-colors"
          >
            {t("newtab.settings")}
          </button>
        </div>
        {showSettings && (
          <Suspense fallback={null}>
            <NewTabSettings onClose={() => setShowSettings(false)} />
          </Suspense>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center bg-[var(--color-surface-base)]"
        role="status"
        aria-label={t("newtab.loading")}
      >
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-[var(--color-surface-base)]">
        <div className="w-full max-w-md">
          <LoginPrompt />
        </div>
      </div>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case "calendar":
        return <CalendarTab />;
      case "dashboard":
        return <DashboardTab />;
      case "prepaid":
        return <PrepaidTab />;
      case "history":
        return <HistoryTab />;
    }
  };

  return (
    <div className="min-h-screen bg-[var(--color-surface-base)] flex flex-col">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* Organization switcher (only shown with >1 org) */}
      <OrgSwitcher />

      {/* Fejl fra fx Start i historikken. Dashboardets Timer viser selv sin. */}
      {activeTab !== "dashboard" && <TimerErrorBanner className="mx-6 mt-3" />}

      {activeTab === "calendar" && <StatsBar />}

      <main
        className={`flex-1 ${
          activeTab === "calendar"
            ? "max-w-full px-6"
            : "max-w-7xl mx-auto w-full px-6 py-4"
        }`}
        key={activeTab}
      >
        <div
          role="tabpanel"
          id={NEWTAB_TABPANEL_ID}
          aria-labelledby={newTabTabId(activeTab)}
          className="h-full"
        >
          <Suspense fallback={null}>{renderTabContent()}</Suspense>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <Suspense fallback={null}>
          <NewTabSettings onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
    </div>
  );
}
