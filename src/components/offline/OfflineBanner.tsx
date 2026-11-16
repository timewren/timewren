"use client";

import { CloudOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOfflineQueueStore } from "@/stores/offlineQueueStore";

/**
 * Bred besked øverst på dashboardet, mens browseren er offline. Status-
 * pillen i toppen (OfflineQueueStatus) viser antal ventende ændringer;
 * banneret forklarer, hvad offline betyder for brugerens arbejde.
 */
export function OfflineBanner() {
  const t = useTranslations("shell.offline");
  const isOnline = useOfflineQueueStore((s) => s.isOnline);

  return (
    <div role="status" aria-live="polite">
      {!isOnline && (
        <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/50">
          <div className="flex items-center gap-2 px-4 py-2.5 text-sm text-amber-900 sm:px-6 lg:px-8 dark:text-amber-200">
            <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
            <span>{t("banner")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
