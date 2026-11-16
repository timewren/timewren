"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

export function RefreshIndicator({
  lastUpdated,
  onRefresh,
  intervalMs,
}: {
  lastUpdated?: Date;
  onRefresh: () => void;
  intervalMs?: number;
}) {
  const t = useTranslations("adminShell");
  const [secondsAgo, setSecondsAgo] = useState(0);

  const updateTimer = useCallback(() => {
    if (!lastUpdated) return;
    setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
  }, [lastUpdated]);

  useEffect(() => {
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [updateTimer]);

  const formatAgo = () => {
    if (secondsAgo < 5) return t("refresh.justNow");
    if (secondsAgo < 60) return t("refresh.secondsAgo", { count: secondsAgo });
    const mins = Math.floor(secondsAgo / 60);
    return t("refresh.minutesAgo", { count: mins });
  };

  return (
    <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
      {lastUpdated && <span>{t("refresh.updated", { ago: formatAgo() })}</span>}
      {intervalMs && (
        <span className="text-xs">
          {t("refresh.auto", { seconds: Math.round(intervalMs / 1000) })}
        </span>
      )}
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        <RefreshCw className="h-3 w-3" />
        {t("refresh.refresh")}
      </button>
    </div>
  );
}
