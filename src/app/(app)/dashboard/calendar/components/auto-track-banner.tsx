import { Clock, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";
import { formatTime } from "../utils/calendar-math";

export function AutoTrackBanner() {
  const t = useTranslations("calendar");
  const utils = trpc.useUtils();
  const { data: suggestions } = trpc.calendar.getAutoTrackSuggestions.useQuery(
    undefined,
    { refetchInterval: 60_000 },
  );
  const { data: settings } = trpc.calendar.getAutoTrackSettings.useQuery();
  const { data: allProjects } = trpc.projects.list.useQuery();
  const [dismissed, setDismissed] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const autoTrack = trpc.calendar.autoTrackEvents.useMutation({
    onSuccess: (data) => {
      toast.success(t("autoTrack.created", { count: data.created }));
      utils.calendar.getAutoTrackSuggestions.invalidate();
      utils.calendar.getEvents.invalidate();
      utils.time.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (dismissed || !settings || settings.mode === "off") return null;

  const visibleSuggestions = (suggestions || []).filter(
    (s) => !dismissedIds.has(s.id),
  );
  if (visibleSuggestions.length === 0) return null;

  const activeProjects =
    allProjects?.filter((p) => p.status === "active")?.slice(0, 15) || [];

  const handleTrackEvent = (
    eventId: string,
    projectId: string,
    clientId?: string,
  ) => {
    autoTrack.mutate({ eventIds: [eventId], projectId, clientId });
    setExpandedEventId(null);
  };

  const handleDismissEvent = (eventId: string) => {
    setDismissedIds((prev) => new Set([...prev, eventId]));
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {t("autoTrack.ready", { count: visibleSuggestions.length })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() =>
              setDismissedIds(
                new Set([
                  ...dismissedIds,
                  ...visibleSuggestions.map((s) => s.id),
                ]),
              )
            }
            className="rounded px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
          >
            {t("autoTrack.dismissAll")}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded p-1 text-amber-600 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-1.5">
        {visibleSuggestions.map((ev) => {
          const isExpanded = expandedEventId === ev.id;
          return (
            <div key={ev.id}>
              <div className="flex items-center justify-between gap-2 rounded-md bg-white/60 px-2.5 py-1.5 dark:bg-gray-800/40">
                <span className="min-w-0 truncate text-xs font-medium text-amber-900 dark:text-amber-100">
                  {ev.title}
                  <span className="ml-1.5 font-normal opacity-70">
                    {ev.startTime ? formatTime(new Date(ev.startTime)) : ""}–
                    {ev.endTime ? formatTime(new Date(ev.endTime)) : ""}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedEventId(isExpanded ? null : ev.id)
                    }
                    disabled={autoTrack.isPending}
                    className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    {t("autoTrack.register")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDismissEvent(ev.id)}
                    className="rounded p-1 text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="mt-1 ml-2 max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-amber-200 bg-white p-2 dark:border-amber-800 dark:bg-gray-900">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                    {t("autoTrack.chooseProject")}
                  </p>
                  {activeProjects.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        handleTrackEvent(ev.id, p.id, p.clientId ?? undefined)
                      }
                      disabled={autoTrack.isPending}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-700"
                    >
                      <span className="font-medium text-gray-900 dark:text-white">
                        {p.name}
                      </span>
                      {p.client?.name && (
                        <span className="text-[10px] text-gray-400">
                          {p.client.name}
                        </span>
                      )}
                    </button>
                  ))}
                  {activeProjects.length === 0 && (
                    <p className="py-2 text-center text-xs text-gray-400">
                      {t("autoTrack.noActiveProjects")}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
