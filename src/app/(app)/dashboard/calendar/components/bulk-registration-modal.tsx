import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useModules } from "@/hooks/useModules";
import { trpc } from "@/providers/trpc-provider";
import type { ClientMatch, TimeBlock } from "../types";
import { formatDuration } from "../utils/calendar-math";

export function BulkRegistrationModal({
  unregisteredPastEvents,
  eventMatches,
  onClose,
}: {
  unregisteredPastEvents: TimeBlock[];
  eventMatches: Record<string, ClientMatch | null>;
  onClose: () => void;
}) {
  const t = useTranslations("calendar");
  const utils = trpc.useUtils();
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: allClients } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });
  const { data: allProjects } = trpc.projects.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("projects"),
  });
  const [clientOverrides, setClientOverrides] = useState<
    Record<string, string>
  >({});
  const [projectOverrides, setProjectOverrides] = useState<
    Record<string, string>
  >({});
  const [expandedClientGroup, setExpandedClientGroup] = useState<string | null>(
    null,
  );
  const [expandedProjectGroup, setExpandedProjectGroup] = useState<
    string | null
  >(null);

  const createEntry = trpc.calendar.createTimeEntryFromEvent.useMutation({
    onSuccess: () => {
      utils.calendar.getEvents.invalidate();
      utils.time.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [processing, setProcessing] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  // Escape-luk + scroll-lock så længe modalen er mounted (ikke under kørsel)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !processing) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [processing, onClose]);

  // Group events by matched client
  const groups = useMemo(() => {
    const map: Record<
      string,
      {
        clientId: string | null;
        clientName: string;
        projectId?: string;
        events: TimeBlock[];
        totalMinutes: number;
      }
    > = {};

    for (const ev of unregisteredPastEvents) {
      const match = eventMatches[ev.rawId];
      const override = clientOverrides[ev.rawId];
      const key = override || match?.clientId || "_unknown";
      const clientName = override
        ? // biome-ignore lint/suspicious/noExplicitAny: Drizzle types
          ((allClients as any[]) || []).find(
            (c: { id: string }) => c.id === override,
          )?.name || t("bulk.unknown")
        : match?.clientName || t("bulk.unknown");

      if (!map[key]) {
        // Project resolution: explicit override > match > auto-pick if client has 1
        let resolvedProjectId = projectOverrides[key] ?? match?.projectId;
        if (!resolvedProjectId && (override || match?.clientId)) {
          // Auto-pick if client has exactly one active project
          const clientProjects = (allProjects || []).filter(
            (p) =>
              p.clientId === (override || match?.clientId) &&
              p.status === "active",
          );
          if (clientProjects.length === 1) {
            resolvedProjectId = clientProjects[0].id;
          }
        }

        map[key] = {
          clientId: override || match?.clientId || null,
          clientName,
          projectId: resolvedProjectId,
          events: [],
          totalMinutes: 0,
        };
      }
      map[key].events.push(ev);
      map[key].totalMinutes += Math.round(
        (ev.endTime.getTime() - ev.startTime.getTime()) / 60000,
      );
    }

    return Object.entries(map).sort(([a], [b]) => {
      if (a === "_unknown") return 1;
      if (b === "_unknown") return -1;
      return 0;
    });
  }, [
    unregisteredPastEvents,
    eventMatches,
    clientOverrides,
    projectOverrides,
    allClients,
    allProjects,
    t,
  ]);

  const activeClients = useMemo(() => {
    if (!allClients) return [];
    return allClients.filter((c) => !c.isArchived);
  }, [allClients]);

  const handleConfirm = async () => {
    setProcessing(true);
    setProcessedCount(0);
    let created = 0;

    for (const [, group] of groups) {
      // Skip groups with no client AND no project (unmatched events)
      if (!group.clientId && !group.projectId) continue;
      for (const ev of group.events) {
        try {
          await createEntry.mutateAsync({
            eventId: ev.rawId,
            projectId: group.projectId,
            clientId: group.clientId ?? undefined,
            description: ev.title,
          });
          created++;
          setProcessedCount((c) => c + 1);
        } catch {
          // Individual failures are already toasted
        }
      }
    }

    if (created > 0) {
      toast.success(t("bulk.created", { count: created }));
    }
    setProcessing(false);
    onClose();
  };

  const canConfirm = groups.some(([, g]) => g.clientId || g.projectId);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !processing) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="mx-4 w-full max-w-md rounded-xl border border-gray-200/80 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("bulk.title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
          {groups.map(([key, group]) => (
            <div
              key={key}
              className="rounded-md border border-gray-100 bg-gray-50 p-2.5 dark:border-gray-800 dark:bg-gray-800/50"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {group.clientName}
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    {t("bulk.summary", {
                      count: group.events.length,
                      duration: formatDuration(group.totalMinutes, {
                        hour: t("units.hour"),
                        minute: t("units.minute"),
                      }),
                    })}
                  </span>
                </div>
                {group.clientId && group.projectId ? (
                  <Check className="h-4 w-4 shrink-0 text-green-500" />
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    {/* Client picker — only when no client */}
                    {!group.clientId && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedClientGroup(
                              expandedClientGroup === key ? null : key,
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                        >
                          {t("bulk.chooseClient")}
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        {expandedClientGroup === key && (
                          <div className="absolute right-0 top-full z-10 mt-1 max-h-40 w-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                            {activeClients.map(
                              (c: { id: string; name: string }) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => {
                                    for (const ev of group.events) {
                                      setClientOverrides((prev) => ({
                                        ...prev,
                                        [ev.rawId]: c.id,
                                      }));
                                    }
                                    setExpandedClientGroup(null);
                                  }}
                                  className="flex w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-600"
                                >
                                  {c.name}
                                </button>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Project picker — when client is set but no project.
                        Project is optional — user can register with just client. */}
                    {group.clientId && !group.projectId && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedProjectGroup(
                              expandedProjectGroup === key ? null : key,
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                        >
                          {t("bulk.chooseProject")}
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        {expandedProjectGroup === key && (
                          <div className="absolute right-0 top-full z-10 mt-1 max-h-40 w-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                            {(() => {
                              const clientProjects = (allProjects || []).filter(
                                (p) =>
                                  p.clientId === group.clientId &&
                                  p.status === "active",
                              );
                              if (clientProjects.length === 0) {
                                return (
                                  <p className="px-3 py-2 text-xs text-gray-400">
                                    {t("bulk.noActiveProjects")}
                                  </p>
                                );
                              }
                              return clientProjects.map(
                                (p: { id: string; name: string }) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => {
                                      setProjectOverrides((prev) => ({
                                        ...prev,
                                        [key]: p.id,
                                      }));
                                      setExpandedProjectGroup(null);
                                    }}
                                    className="flex w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-600"
                                  >
                                    {p.name}
                                  </button>
                                ),
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {t("bulk.cancel")}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm || processing}
            className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {processing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {processedCount}/{unregisteredPastEvents.length}
              </>
            ) : (
              t("bulk.confirm")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
