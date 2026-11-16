import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LogOut, Settings, WifiOff } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { apiClient } from "../api/client";
import { deriveWebAppUrl } from "../config";
import { useTheme } from "../hooks/useTheme";
import { useT } from "../i18n";
import { formatHoursShort } from "../lib/format-hours";
import { draftFromSearchParams } from "../lib/quick-entry-draft";
import { timerSecondsToday } from "../lib/today-hours";
import { useAuthStore } from "../stores/authStore";
import { useOfflineStore } from "../stores/offlineStore";
import { useQuickEntryStore } from "../stores/quickEntryStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSiteStore } from "../stores/siteStore";
import { useTimerStore } from "../stores/timerStore";
import { getTodayStr } from "../utils/date";
import { BrandIcon } from "./components/BrandIcon";
import { IdlePromptBanner } from "./components/IdlePromptBanner";
import { InlineConfirm } from "./components/InlineConfirm";
import { LoginPrompt } from "./components/LoginPrompt";
import { MiniTimer } from "./components/MiniTimer";
import { OrgSwitcher } from "./components/OrgSwitcher";
import { SyncStatus } from "./components/SyncStatus";
import {
  POPUP_TABPANEL_ID,
  type PopupTab,
  popupTabId,
  TabBar,
} from "./components/TabBar";
import { TimerErrorBanner } from "./components/TimerErrorBanner";
import { TimerTab } from "./components/tabs/TimerTab";
import { UpdateBanner } from "./components/UpdateBanner";
import { useLogoutWarnings } from "./hooks/useLogoutWarnings";

// Faner og indstillinger hentes først, når de åbnes: Timer-fanen er den,
// popup'en åbner på, og resten skal ikke parses ved hver åbning.
const SettingsPanel = lazy(() =>
  import("./components/SettingsPanel").then((m) => ({
    default: m.SettingsPanel,
  })),
);
const CalendarTab = lazy(() =>
  import("./components/tabs/CalendarTab").then((m) => ({
    default: m.CalendarTab,
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

function TabFallback() {
  const { t } = useT();
  return (
    <div
      className="flex justify-center p-6"
      role="status"
      aria-label={t("popup.loading")}
    >
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
    </div>
  );
}

export default function App() {
  const { t } = useT();
  const { isAuthenticated, isLoading, user, checkAuth, logout } =
    useAuthStore();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  // Select only `timer` — subscribing to the whole store would re-render App
  // (header, progress bar, tabs) on every 1s displayTime tick.
  const timer = useTimerStore((s) => s.timer);
  const detectCurrentSite = useSiteStore((s) => s.detectCurrentSite);
  const { settings, loadSettings } = useSettingsStore();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const [showSettings, setShowSettings] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const logoutWarnings = useLogoutWarnings();
  const [activeTab, setActiveTab] = useState<PopupTab>("timer");
  const webAppUrl = deriveWebAppUrl(settings.apiUrl);

  // Initialize theme
  useTheme();

  useEffect(() => {
    checkAuth();
    loadSettings();
  }, [checkAuth, loadSettings]);

  // Klippekort-fanen kan slås fra i Indstillinger
  useEffect(() => {
    if (!settings.showPrepaidStatus && activeTab === "prepaid") {
      setActiveTab("timer");
    }
  }, [settings.showPrepaidStatus, activeTab]);

  // Popup-vinduet fra genvejen Hurtig registrering og "Kopier" i ny fane
  // åbnes med ?action=quick-entry&… — åbn Hurtig registrering forudfyldt.
  useEffect(() => {
    const draft = draftFromSearchParams(
      new URLSearchParams(window.location.search),
    );
    if (!draft) return;
    setActiveTab("timer");
    useQuickEntryStore.getState().openDraft(draft);
  }, []);

  // Det aktive websted til site-forslaget på Timer-fanen. Læses her én
  // gang pr. åbning via tabs-API'et (activeTab); intet content script.
  useEffect(() => {
    void detectCurrentSite();
  }, [detectCurrentSite]);

  // Fetch today's time entries for mini daily status
  const todayStr = getTodayStr();
  const { data: todayEntries } = useQuery({
    queryKey: ["timeEntries", todayStr, selectedOrgId],
    queryFn: () => apiClient.getTimeEntries(todayStr, todayStr),
    staleTime: 1000 * 60 * 2,
    enabled: isAuthenticated && orgsLoaded,
  });

  // Den kørende/pausede timer tæller med i "i dag". Kun hele minutter
  // abonneres, så headeren ikke tegnes om hvert sekund.
  const timerMinutes = useTimerStore((s) =>
    s.remoteStopping
      ? 0
      : Math.floor(timerSecondsToday(s.timer, Date.now()) / 60),
  );
  const todayHours =
    (todayEntries?.reduce((sum, e) => sum + e.hours, 0) ?? 0) +
    timerMinutes / 60;
  const dailyGoal = settings.dailyGoalHours || 8;
  const progressPct = Math.min((todayHours / dailyGoal) * 100, 100);

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center h-full bg-[var(--color-surface-base)]"
        role="status"
        aria-label={t("popup.loading")}
      >
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPrompt />;
  }

  const formatDayHours = (h: number) => {
    return t("popup.todayHours", { duration: formatHoursShort(h) });
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "timer":
        return <TimerTab />;
      case "calendar":
        return <CalendarTab />;
      case "history":
        return <HistoryTab onOpenQuickEntry={() => setActiveTab("timer")} />;
      case "prepaid":
        return <PrepaidTab onTimerStarted={() => setActiveTab("timer")} />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface-base)]">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 bg-[var(--color-surface-elevated)] border-b border-[var(--color-border-default)]">
        <div className="flex items-center gap-2">
          <BrandIcon size={28} />
          <div>
            <h1 className="text-sm font-bold tracking-[-0.02em] text-[var(--color-text-primary)] leading-tight">
              TimeTrack
            </h1>
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-[var(--color-text-tertiary)] leading-tight">
                {user?.name}
              </p>
              {todayEntries && (
                <span className="text-xs text-primary-600 font-medium leading-tight">
                  {formatDayHours(todayHours)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!isOnline && (
            <div
              className="p-2 text-[var(--color-warning-text)]"
              title={t("popup.noInternet")}
              role="status"
              aria-label={t("popup.offline")}
            >
              <WifiOff size={18} aria-hidden="true" />
            </div>
          )}
          <button
            type="button"
            onClick={() => window.open(`${webAppUrl}/dashboard`, "_blank")}
            className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-lg transition-colors"
            title={t("popup.openApp")}
            aria-label={t("popup.openAppNewTab")}
          >
            <ExternalLink size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-lg transition-colors"
            title={t("popup.settings")}
            aria-label={t("popup.settings")}
            aria-haspopup="dialog"
          >
            <Settings size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setConfirmLogout(true)}
            className="p-2 text-[var(--color-text-tertiary)] hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title={t("popup.logout")}
            aria-label={t("popup.logout")}
          >
            <LogOut size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      {confirmLogout && (
        <InlineConfirm
          className="mx-4 mt-2"
          message={t("popup.logoutConfirm")}
          details={logoutWarnings}
          confirmLabel={t("popup.logout")}
          onConfirm={() => {
            setConfirmLogout(false);
            logout();
          }}
          onCancel={() => setConfirmLogout(false)}
        />
      )}

      <UpdateBanner />

      <IdlePromptBanner className="mx-4 mt-2" />

      {/* Organization switcher (only shown with >1 org) */}
      <OrgSwitcher />

      {/* Daily progress bar */}
      {todayEntries && (
        <div className="px-4 py-1.5 bg-[var(--color-surface-elevated)] border-b border-[var(--color-border-subtle)]">
          <div
            className="h-1 w-full bg-[var(--color-surface-sunken)] rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(todayHours * 10) / 10}
            aria-valuemin={0}
            aria-valuemax={dailyGoal}
            aria-label={t("popup.dailyProgress", {
              done: formatHoursShort(todayHours),
              goal: dailyGoal,
            })}
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                progressPct >= 100 ? "bg-primary-700" : "bg-primary-600"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Sync Status */}
      <SyncStatus />

      {/* Tab Bar */}
      <TabBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        hiddenTabs={settings.showPrepaidStatus ? [] : ["prepaid"]}
      />

      {/* Mini Timer — shown on non-Timer tabs when timer is running */}
      {activeTab !== "timer" && timer?.isRunning && (
        <MiniTimer onSwitchToTimer={() => setActiveTab("timer")} />
      )}

      {/* Fejl fra en timerhandling uden for Timer-fanen (fx Start fra
          historikken) — Timer-fanen viser selv sin */}
      {activeTab !== "timer" && <TimerErrorBanner className="mx-4 mt-2" />}

      {/* Tab Content */}
      <main className="flex-1 overflow-y-auto" key={activeTab}>
        <div
          className="animate-tab-enter"
          role="tabpanel"
          id={POPUP_TABPANEL_ID}
          aria-labelledby={popupTabId(activeTab)}
        >
          <Suspense fallback={<TabFallback />}>{renderTabContent()}</Suspense>
        </div>
      </main>

      {/* Settings Panel */}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
    </div>
  );
}
