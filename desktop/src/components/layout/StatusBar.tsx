import { useNavigate } from "@tanstack/react-router";
import { getVersion } from "@tauri-apps/api/app";
import { Circle, Cloud, CloudOff, Loader2, Pause, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { formatElapsed } from "@/lib/format";
import { useSettingsStore } from "@/stores/settingsStore";
import { useSyncStore } from "@/stores/syncStore";
import { useTimerStore } from "@/stores/timerStore";

export function StatusBar() {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState("");
  const { trackingPaused } = useSettingsStore();
  // Use specific selectors to avoid re-rendering on every timer tick (1s).
  // The elapsed value is read only in the timer display span below.
  const isRunning = useTimerStore((s) => s.isRunning);
  const elapsed = useTimerStore((s) => s.elapsed);
  const projectName = useTimerStore((s) => s.projectName);
  const clientName = useTimerStore((s) => s.clientName);
  const isLoggedIn = useSyncStore((s) => s.isLoggedIn);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const pendingChanges = useSyncStore((s) => s.pendingChanges);
  const error = useSyncStore((s) => s.error);
  const isOnline = useNetworkStatus();
  const navigate = useNavigate();

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("0.1.0"));
  }, []);

  function handleSyncClick() {
    navigate({ to: "/settings", search: { tab: "sync" } as never });
  }

  return (
    <div className="flex h-7 items-center justify-between border-t border-(--color-border) bg-(--color-surface) px-3">
      <div className="flex items-center gap-2">
        {trackingPaused ? (
          <>
            <Pause size={10} className="text-yellow-500" />
            <span className="text-[11px] text-yellow-500">
              {t("timer.paused")}
            </span>
          </>
        ) : isRunning ? (
          <>
            <Circle
              size={8}
              className="animate-pulse-dot fill-emerald-500 text-emerald-500"
            />
            <span className="text-[11px] text-emerald-500 truncate max-w-[200px]">
              {projectName
                ? clientName
                  ? `${projectName} — ${clientName}`
                  : projectName
                : t("timer.active")}
            </span>
          </>
        ) : (
          <>
            <Circle size={8} className="fill-gray-400 text-gray-400" />
            <span className="text-[11px] text-(--color-text-muted)">
              {t("timer.noActiveTimer")}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-4">
        {/* Offline indicator */}
        {!isOnline && (
          <span
            className="flex items-center gap-1 text-[11px] text-yellow-500"
            title={t("errors.offline")}
          >
            <WifiOff size={12} />
            {t("sync.offline")}
          </span>
        )}

        {/* Sync indicator */}
        <button
          type="button"
          onClick={handleSyncClick}
          className="flex items-center gap-1 text-[11px] transition-colors hover:text-(--color-text)"
          aria-label={
            !isLoggedIn
              ? t("sync.notConnected")
              : isSyncing
                ? t("sync.syncing")
                : error
                  ? t("sync.syncError", { error })
                  : pendingChanges > 0
                    ? t("sync.pendingCount", { count: pendingChanges })
                    : t("sync.synced")
          }
          title={
            !isLoggedIn
              ? t("sync.notConnected")
              : isSyncing
                ? t("sync.syncing")
                : error
                  ? t("sync.syncError", { error })
                  : pendingChanges > 0
                    ? t("sync.pendingShort", { count: pendingChanges })
                    : t("sync.synced")
          }
        >
          {!isLoggedIn ? (
            <CloudOff size={12} className="text-gray-500" />
          ) : isSyncing ? (
            <Loader2 size={12} className="animate-spin text-blue-400" />
          ) : error ? (
            <Cloud size={12} className="text-red-400" />
          ) : pendingChanges > 0 ? (
            <Cloud size={12} className="text-yellow-400" />
          ) : (
            <Cloud size={12} className="text-emerald-400" />
          )}
        </button>

        <span
          className={`font-mono text-[11px] ${
            isRunning ? "text-emerald-500" : "text-(--color-text-muted)"
          }`}
        >
          {formatElapsed(elapsed)}
        </span>

        {appVersion && (
          <span className="text-[10px] text-(--color-text-muted)/50">
            v{appVersion}
          </span>
        )}
      </div>
    </div>
  );
}
