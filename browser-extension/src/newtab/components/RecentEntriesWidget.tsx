import { useQuery } from "@tanstack/react-query";
import { Clock, Copy, Play } from "lucide-react";
import { apiClient } from "../../api/client";
import { toIntlLocale, useT } from "../../i18n";
import { formatHoursShort } from "../../lib/format-hours";
import { openPopupWindow } from "../../lib/popup-window";
import { quickEntryPath } from "../../lib/quick-entry-draft";
import { useAuthStore } from "../../stores/authStore";
import { useTimerStore } from "../../stores/timerStore";

interface TimeEntry {
  id: string;
  description: string;
  hours: number;
  date: string;
  projectId: string | null;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
}

export function RecentEntriesWidget() {
  const { t, locale } = useT();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const { data: entries, isLoading } = useQuery({
    queryKey: ["recentEntries", selectedOrgId],
    queryFn: async (): Promise<TimeEntry[]> => {
      return apiClient.getRecentEntries(5);
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: orgsLoaded,
  });

  const formatDate = (dateString: string) => {
    // Parse date string as local date (not UTC) to avoid timezone shift
    const parts = dateString.split("T")[0].split("-");
    const date = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2]),
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.getTime() === today.getTime()) {
      return t("format.today");
    }
    if (date.getTime() === yesterday.getTime()) {
      return t("format.yesterday");
    }
    return date.toLocaleDateString(toIntlLocale(locale), {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse">
        <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-4">
          {t("newtab.recent.title")}
        </h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[var(--color-surface-sunken)] rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-[var(--color-surface-sunken)] rounded w-3/4" />
                <div className="h-3 bg-[var(--color-surface-sunken)] rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div>
        <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-4">
          {t("newtab.recent.title")}
        </h2>
        <div className="text-center py-8 text-[var(--color-text-muted)]">
          <Clock className="w-12 h-12 mx-auto mb-2 text-[var(--color-text-muted)]" />
          <p>{t("newtab.recent.empty")}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-4">
        {t("newtab.recent.title")}
      </h2>

      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--color-surface-sunken)] transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-[var(--color-text-primary)] truncate text-sm">
                {entry.description || t("newtab.recent.noDescription")}
              </div>
              <div className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                {entry.clientName || t("newtab.recent.internal")}
                {entry.projectName && `, ${entry.projectName}`}
              </div>
            </div>

            <div className="flex flex-col items-end flex-shrink-0">
              <span className="text-sm font-medium tabular-nums text-[var(--color-text-primary)]">
                {formatHoursShort(entry.hours)}
              </span>
              <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap mt-0.5">
                {formatDate(entry.date)}
              </span>
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <CopyEntryButton entry={entry} />
              <PlayEntryButton entry={entry} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayEntryButton({ entry }: { entry: TimeEntry }) {
  const { t } = useT();
  const startTimer = useTimerStore((s) => s.startTimer);
  return (
    <button
      type="button"
      onClick={() =>
        startTimer(entry.projectId, entry.clientId, entry.description || "")
      }
      className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-primary-600 hover:bg-[var(--color-surface-sunken)] transition-colors"
      title={t("newtab.recent.startTimer")}
      aria-label={t("newtab.recent.startTimer")}
    >
      <Play size={13} />
    </button>
  );
}

function CopyEntryButton({ entry }: { entry: TimeEntry }) {
  const { t } = useT();
  // Open popup with quick-entry pre-filled (popup/App.tsx læser URL'en)
  const handleCopy = () => {
    void openPopupWindow(
      quickEntryPath({
        projectId: entry.projectId,
        clientId: entry.clientId,
        hours: entry.hours,
        description: entry.description || "",
      }),
    );
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--color-text-muted)] hover:text-primary-600 hover:bg-[var(--color-surface-sunken)] transition-colors"
      title={t("newtab.recent.copy")}
      aria-label={t("newtab.recent.copy")}
    >
      <Copy size={13} />
    </button>
  );
}
