import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  CreditCard,
  ExternalLink,
  History,
  LayoutDashboard,
  LogOut,
  Settings,
  Square,
} from "lucide-react";
import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { deriveWebAppUrl } from "../../config";
import { useT } from "../../i18n";
import { tabKeyTarget } from "../../lib/tablist";
import { BrandIcon } from "../../popup/components/BrandIcon";
import { ElapsedClock } from "../../popup/components/ElapsedClock";
import { InlineConfirm } from "../../popup/components/InlineConfirm";
import { StopPrompt } from "../../popup/components/StopPrompt";
import { useLogoutWarnings } from "../../popup/hooks/useLogoutWarnings";
import { useAuthStore } from "../../stores/authStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useTimerStore } from "../../stores/timerStore";

export type NewTabTab = "calendar" | "dashboard" | "prepaid" | "history";

interface TopBarProps {
  activeTab: NewTabTab;
  onTabChange: (tab: NewTabTab) => void;
  onOpenSettings: () => void;
}

const TABS: { id: NewTabTab; icon: typeof Calendar }[] = [
  { id: "calendar", icon: Calendar },
  { id: "dashboard", icon: LayoutDashboard },
  { id: "prepaid", icon: CreditCard },
  { id: "history", icon: History },
];

export const NEWTAB_TABPANEL_ID = "nyfane-fanepanel";
export const newTabTabId = (tab: NewTabTab) => `nyfane-fane-${tab}`;

export function TopBar({
  activeTab,
  onTabChange,
  onOpenSettings,
}: TopBarProps) {
  const { t } = useT();
  const { logout } = useAuthStore();
  const { settings } = useSettingsStore();
  const webAppUrl = deriveWebAppUrl(settings.apiUrl);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const logoutWarnings = useLogoutWarnings();

  return (
    <header className="flex items-center justify-between px-6 py-3 bg-[var(--color-surface-elevated)] border-b border-[var(--color-border-default)]">
      {/* Left: Logo */}
      <div className="flex items-center gap-3">
        <BrandIcon size={32} />
        <span className="text-base font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
          TimeTrack
        </span>
      </div>

      {/* Center: Pill tabs */}
      <div
        role="tablist"
        aria-label={t("newtab.view")}
        className="flex gap-1 bg-[var(--color-surface-sunken)] rounded-lg p-1"
      >
        {TABS.map((tab, i) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={newTabTabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={NEWTAB_TABPANEL_ID}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(e) => {
                const next = tabKeyTarget(TABS.length, i, e.key);
                if (next === null) return;
                e.preventDefault();
                onTabChange(TABS[next].id);
                document.getElementById(newTabTabId(TABS[next].id))?.focus();
              }}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                isActive
                  ? "bg-[var(--color-surface-base)] text-[var(--color-text-primary)] shadow-sm"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              <Icon size={14} aria-hidden="true" />
              {t(`newtab.tabs.${tab.id}`)}
            </button>
          );
        })}
      </div>

      {/* Right: Mini timer + actions */}
      <div className="flex items-center gap-2">
        {/* Dashboardets Timer-widget (hvis den er slået til) har selv
            samme spørgsmål */}
        <MiniTimerChip
          showStopPrompt={
            activeTab !== "dashboard" ||
            !settings.newTabWidgets.includes("timer")
          }
        />
        <div className="flex items-center gap-1 bg-[var(--color-surface-sunken)] rounded-lg p-0.5">
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-base)] rounded-md transition-colors"
            title={t("newtab.settings")}
            aria-label={t("newtab.settings")}
            aria-haspopup="dialog"
          >
            <Settings size={16} aria-hidden="true" />
          </button>
          <a
            href={`${webAppUrl}/dashboard`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-base)] rounded-md transition-colors"
            title={t("newtab.openApp")}
            aria-label={t("newtab.openAppNewTab")}
          >
            <ExternalLink size={16} aria-hidden="true" />
          </a>
          <div className="relative">
            <button
              type="button"
              onClick={() => setConfirmLogout(true)}
              className="p-2 text-[var(--color-text-tertiary)] hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
              title={t("newtab.logout")}
              aria-label={t("newtab.logout")}
            >
              <LogOut size={16} aria-hidden="true" />
            </button>
            {confirmLogout && (
              <InlineConfirm
                className="absolute right-0 top-full mt-2 w-72 z-40 shadow-lg"
                message={t("newtab.logoutConfirm")}
                details={logoutWarnings}
                confirmLabel={t("newtab.logout")}
                onConfirm={() => {
                  setConfirmLogout(false);
                  logout();
                }}
                onCancel={() => setConfirmLogout(false)}
              />
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function MiniTimerChip({ showStopPrompt }: { showStopPrompt: boolean }) {
  const { t } = useT();
  const timer = useTimerStore((s) => s.timer);
  const requestStop = useTimerStore((s) => s.requestStop);
  const tick = useTimerStore((s) => s.tick);
  const stopPromptOpen = useTimerStore((s) => s.stopPromptOpen);

  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);

  // Kunder og projekter skal kun bruges til chippens navn og stop-spørgsmålet
  const { data: projectsData } = useQuery({
    queryKey: ["projectsAndClients", selectedOrgId],
    queryFn: apiClient.getProjectsAndClients,
    staleTime: 1000 * 60 * 5,
    enabled: orgsLoaded && (!!timer?.isRunning || stopPromptOpen),
  });

  useEffect(() => {
    if (!timer?.isRunning) return;
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [timer?.isRunning, tick]);

  // Stop uden kunde spørger først, som i popup'en
  const prompt = showStopPrompt && (
    <StopPrompt
      clients={projectsData?.clients || []}
      projects={projectsData?.projects || []}
      className="absolute right-0 top-full mt-2 w-72 z-40 shadow-lg"
    />
  );

  if (!timer?.isRunning) return <div className="relative">{prompt}</div>;

  const project = projectsData?.projects.find((p) => p.id === timer?.projectId);
  const client = projectsData?.clients.find((c) => c.id === timer?.clientId);
  const label =
    client?.name ||
    project?.name ||
    timer?.description ||
    t("newtab.timerLabel");

  return (
    <div className="relative flex items-center gap-2.5 px-3 py-1.5 bg-[var(--color-surface-sunken)] rounded-full">
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-success)] opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-success)]" />
      </span>
      <span className="text-xs font-semibold text-[var(--color-success)]">
        <ElapsedClock />
      </span>
      <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-[120px]">
        {label}
      </span>
      <button
        type="button"
        onClick={() => requestStop(project?.name ?? null, client?.name ?? null)}
        className="w-6 h-6 rounded-full bg-[var(--color-danger)] flex items-center justify-center flex-shrink-0 hover:opacity-80 transition-opacity"
        title={t("newtab.stopTimer")}
        aria-label={t("newtab.stopTimerFor", { label })}
      >
        <Square
          size={10}
          className="text-white"
          fill="white"
          aria-hidden="true"
        />
      </button>
      {prompt}
    </div>
  );
}
