"use client";

import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useOfflineQueueSync } from "@/hooks/useOfflineQueueSync";
import {
  failedCount,
  pendingCount,
  queueStatus,
  type StatusTone,
} from "@/lib/offline/queue";
import { useOfflineQueueStore } from "@/stores/offlineQueueStore";

const SYNCED_VISIBLE_MS = 4_000;

const TONE_CLASSES: Record<StatusTone, string> = {
  offline:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200",
  pending:
    "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-200",
  error:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/60 dark:text-red-200",
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200",
};

function ToneIcon({ tone, syncing }: { tone: StatusTone; syncing: boolean }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (tone === "offline") return <CloudOff className={cls} aria-hidden />;
  if (tone === "error") return <AlertTriangle className={cls} aria-hidden />;
  if (tone === "ok") return <CheckCircle2 className={cls} aria-hidden />;
  return (
    <RefreshCw
      className={`${cls} ${syncing ? "motion-safe:animate-spin" : ""}`}
      aria-hidden
    />
  );
}

/**
 * Status for offline-køen (#703): "Offline – 3 ændringer venter" mens nettet
 * er væk, kort "Synkroniseret" når køen er afspillet. Monterer også selve
 * dræningen, så den kører på alle dashboard-sider.
 */
export function OfflineQueueStatus() {
  const t = useTranslations("shell.offline");
  const { drain } = useOfflineQueueSync();
  const items = useOfflineQueueStore((s) => s.items);
  const isOnline = useOfflineQueueStore((s) => s.isOnline);
  const isSyncing = useOfflineQueueStore((s) => s.isSyncing);
  const lastSyncedAt = useOfflineQueueStore((s) => s.lastSyncedAt);
  const retryAll = useOfflineQueueStore((s) => s.retryAll);
  const discardFailed = useOfflineQueueStore((s) => s.discardFailed);

  const [justSynced, setJustSynced] = useState(false);
  useEffect(() => {
    if (!lastSyncedAt) return;
    setJustSynced(true);
    const timer = setTimeout(() => setJustSynced(false), SYNCED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [lastSyncedAt]);

  const failed = failedCount(items);
  const pending = pendingCount(items);
  const status = queueStatus({
    online: isOnline,
    pending,
    failed,
    syncing: isSyncing,
    justSynced,
  });
  // Teksten bygges her efter samme regler som queueStatus (lib/offline/queue)
  const statusLabel = status
    ? !isOnline
      ? pending > 0
        ? t("status.offlinePending", { count: pending })
        : t("status.offline")
      : failed > 0
        ? t("status.failed", { count: failed })
        : pending > 0
          ? isSyncing
            ? t("status.syncing", { count: pending })
            : t("status.waiting", { count: pending })
          : t("status.synced")
    : "";

  return (
    <div role="status" aria-live="polite" className="shrink-0">
      {status && (
        <div
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${TONE_CLASSES[status.tone]}`}
        >
          <ToneIcon tone={status.tone} syncing={isSyncing} />
          <span className="whitespace-nowrap">{statusLabel}</span>
          {status.tone === "error" && (
            <>
              <button
                type="button"
                onClick={() => {
                  retryAll();
                  void drain();
                }}
                className="ml-1 min-h-6 rounded px-1.5 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1"
              >
                {t("retry")}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t("discardConfirm", { count: failed }))) {
                    discardFailed();
                  }
                }}
                className="min-h-6 rounded px-1.5 underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-1"
              >
                {t("discard")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
