import {
  AlertCircle,
  ChevronDown,
  CloudOff,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { useOfflineStore } from "../../stores/offlineStore";

/**
 * Request the background service worker to process the offline queue.
 * This avoids the popup and background both processing the queue
 * simultaneously, which could cause duplicate time entries.
 */
function requestBackgroundSync() {
  chrome.runtime.sendMessage({ type: "PROCESS_OFFLINE_QUEUE" }).catch(() => {
    // Background may not be running — it will process on next wake
  });
}

export function SyncStatus() {
  const { t } = useT();
  const { isOnline, queue, isSyncing, lastSyncError, loadQueue } =
    useOfflineStore();
  const [showDetails, setShowDetails] = useState(false);

  // Load queue on mount
  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Keep the count in sync with chrome.storage: the background worker drains
  // the queue in its own context, so without this the popup would keep showing
  // "N venter på sync" until reopened.
  useEffect(() => {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area === "local" && changes.offlineQueue) {
        loadQueue();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [loadQueue]);

  // Request background sync when coming back online
  useEffect(() => {
    if (isOnline && queue.length > 0 && !isSyncing) {
      requestBackgroundSync();
    }
  }, [isOnline, queue.length, isSyncing]);

  const handleManualSync = () => {
    if (isOnline && queue.length > 0 && !isSyncing) {
      requestBackgroundSync();
    }
  };

  // Don't show if online and no pending items
  if (isOnline && queue.length === 0 && !lastSyncError) {
    return null;
  }

  return (
    <div
      className={`px-3 py-2 flex flex-wrap items-center justify-between gap-y-1 text-xs ${
        !isOnline
          ? "bg-amber-50 text-[var(--color-warning-text)] border-b border-amber-200"
          : lastSyncError
            ? "bg-red-50 text-red-700 border-b border-red-200"
            : "bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)] border-b border-[var(--color-border-default)]"
      }`}
    >
      <div className="flex items-center gap-2">
        {!isOnline ? (
          <>
            <WifiOff size={14} />
            <span>{t("popup.offline")}</span>
          </>
        ) : isSyncing ? (
          <>
            <RefreshCw size={14} className="animate-spin" />
            <span>{t("popup.sync.syncing")}</span>
          </>
        ) : lastSyncError ? (
          <>
            <AlertCircle size={14} />
            <span>{lastSyncError}</span>
          </>
        ) : (
          <>
            <CloudOff size={14} />
            <span>{t("popup.sync.pending", { count: queue.length })}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-1">
        {queue.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="w-6 h-6 inline-flex items-center justify-center hover:bg-[var(--color-surface-sunken)] rounded transition-colors"
            title={
              showDetails
                ? t("popup.sync.hideDetails")
                : t("popup.sync.showDetails")
            }
            aria-label={
              showDetails
                ? t("popup.sync.hideDetails")
                : t("popup.sync.showDetails")
            }
            aria-expanded={showDetails}
          >
            <ChevronDown
              size={14}
              className={`transition-transform ${showDetails ? "rotate-180" : ""}`}
            />
          </button>
        )}
        {queue.length > 0 && isOnline && !isSyncing && (
          <button
            type="button"
            onClick={handleManualSync}
            className="flex items-center gap-1 px-2 min-h-6 bg-[var(--color-surface-elevated)] border border-[var(--color-border-strong)] text-[var(--color-text-primary)] rounded-lg hover:bg-[var(--color-surface-sunken)] transition-colors"
          >
            <RefreshCw size={12} />
            {t("popup.sync.syncNow")}
          </button>
        )}
      </div>

      {/* Queue detail view */}
      {showDetails && queue.length > 0 && (
        <div className="basis-full mt-1 space-y-1">
          {queue.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between px-2 py-1 bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] rounded text-xs"
            >
              <span className="truncate">
                {item.type === "createTimeEntry"
                  ? t("popup.sync.entry", {
                      description:
                        (item.payload as { description?: string })
                          .description || t("popup.sync.noDescription"),
                    })
                  : item.type === "updateTimerState"
                    ? t("popup.sync.timerUpdate")
                    : t("popup.sync.timerStop")}
              </span>
              {item.retryCount > 0 && (
                <span className="shrink-0 ml-2 text-[var(--color-text-secondary)]">
                  {t("popup.sync.tries", { count: item.retryCount })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
