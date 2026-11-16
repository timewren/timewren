import { skipToken } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useModules } from "@/hooks/useModules";
import { trpc } from "@/providers/trpc-provider";
import type { ClientMatch, TimeBlock } from "../types";
import { formatTime } from "../utils/calendar-math";

export function ClientPickerModal({
  block,
  onClose,
}: {
  block: TimeBlock;
  onClose: () => void;
}) {
  const t = useTranslations("calendar");
  const utils = trpc.useUtils();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [rememberChoice, setRememberChoice] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // refreshKey: indholdet udskiftes helt når man går til projekt-valg
  useFocusTrap(dialogRef, true, selectedClientId);

  // Escape-luk + scroll-lock så længe modalen er mounted
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const { data: matchResults } = trpc.calendar.matchClient.useQuery(
    {
      eventTitle: block.title,
      eventDescription: block.description || undefined,
    },
    { enabled: true },
  );

  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: allClients } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });
  const { data: allProjectsData } = trpc.projects.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("projects"),
  });

  // Fetch projects for the selected client
  const { data: clientProjects } = trpc.projects.getByClient.useQuery(
    selectedClientId ? { clientId: selectedClientId } : skipToken,
  );

  const createEntry = trpc.calendar.createTimeEntryFromEvent.useMutation({
    onSuccess: (data) => {
      toast.success(
        t("picker.registered", { hours: data.hours, title: block.title }),
      );
      utils.calendar.getEvents.invalidate();
      utils.time.list.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const createRule = trpc.calendar.createMatchingRule.useMutation({
    onSuccess: () => {
      utils.calendar.listMatchingRules.invalidate();
    },
  });

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const handleSelectClient = useCallback(
    (clientId: string) => {
      // Look up active projects for this client from the loaded list
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle relation types vary
      const activeProjects = ((allProjectsData as any[]) || []).filter(
        (p: { clientId: string; status: string | null }) =>
          p.clientId === clientId && p.status === "active",
      );

      if (activeProjects.length === 1) {
        // Single active project - create entry directly (UX optimization)
        createEntry.mutate({
          eventId: block.rawId,
          projectId: activeProjects[0].id,
          clientId,
        });
        if (rememberChoice) {
          createRule.mutate({
            pattern: block.title,
            clientId,
            source: "learned",
          });
        }
      } else {
        // 0 or multiple projects - show project picker
        setSelectedClientId(clientId);
      }
    },
    [
      block.rawId,
      block.title,
      createEntry,
      createRule,
      rememberChoice,
      allProjectsData,
    ],
  );

  const handleSelectProject = useCallback(
    (projectId: string) => {
      if (!selectedClientId) return;
      createEntry.mutate({
        eventId: block.rawId,
        projectId,
        clientId: selectedClientId,
      });
      if (rememberChoice) {
        createRule.mutate({
          pattern: block.title,
          clientId: selectedClientId,
          projectId,
          source: "learned",
        });
      }
    },
    [
      block.rawId,
      block.title,
      selectedClientId,
      createEntry,
      createRule,
      rememberChoice,
    ],
  );

  // Build the client list from suggestions + all clients
  const suggestedClients: ClientMatch[] = matchResults ?? [];

  const allActiveClients = useMemo(() => {
    if (!allClients) return [];
    return allClients.filter((c) => !c.isArchived);
  }, [allClients]);

  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return allActiveClients;
    const q = searchQuery.toLowerCase();
    return allActiveClients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q),
    );
  }, [allActiveClients, searchQuery]);

  // If we are in project selection mode
  if (selectedClientId && clientProjects) {
    const activeProjects = clientProjects.filter(
      (p: { status: string | null }) => p.status === "active",
    );
    const clientName =
      suggestedClients.find((s) => s.clientId === selectedClientId)
        ?.clientName ??
      allActiveClients.find((c: { id: string }) => c.id === selectedClientId)
        ?.name ??
      t("picker.clientFallback");

    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          className="mx-4 w-full max-w-sm rounded-xl border border-gray-200/80 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedClientId(null)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("picker.chooseProjectFor", { client: clientName })}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 max-h-48 space-y-1 overflow-y-auto">
            {/* Option to register without project — client-only entry */}
            <button
              type="button"
              disabled={createEntry.isPending}
              onClick={() => {
                createEntry.mutate({
                  eventId: block.rawId,
                  clientId: selectedClientId,
                  description: block.title,
                });
              }}
              className="flex w-full items-center gap-2 rounded-md border border-dashed border-gray-200 px-2.5 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {t("picker.withoutProject")}
            </button>
            {activeProjects.map((p: { id: string; name: string }) => (
              <button
                key={p.id}
                type="button"
                disabled={createEntry.isPending}
                onClick={() => handleSelectProject(p.id)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-700"
              >
                <span className="font-medium text-gray-900 dark:text-white">
                  {p.name}
                </span>
              </button>
            ))}
          </div>

          {createEntry.isPending && (
            <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-gray-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("picker.creating")}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="mx-4 w-full max-w-sm rounded-xl border border-gray-200/80 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("picker.title")}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2 rounded-md bg-brand-50 p-2 text-xs text-brand-800 dark:bg-tt-gran-lys dark:text-brand-200">
          <p className="font-medium">{block.title}</p>
          <p className="opacity-70">
            {formatTime(block.startTime)} – {formatTime(block.endTime)}
          </p>
        </div>

        {/* Search field */}
        <div className="relative mt-3">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("picker.searchPlaceholder")}
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500"
          />
        </div>

        {/* Suggested clients */}
        {!searchQuery && suggestedClients.length > 0 && (
          <>
            <p className="mt-3 text-xs font-medium text-gray-600 dark:text-gray-300">
              {t("picker.suggested")}
            </p>
            <div className="mt-1.5 space-y-1">
              {suggestedClients.map((s) => {
                return (
                  <button
                    key={`suggestion-${s.clientId}`}
                    type="button"
                    disabled={createEntry.isPending}
                    onClick={() => {
                      // If we have a projectId from the match, use it directly
                      if (s.projectId) {
                        createEntry.mutate({
                          eventId: block.rawId,
                          projectId: s.projectId,
                          clientId: s.clientId,
                        });
                        if (rememberChoice) {
                          createRule.mutate({
                            pattern: block.title,
                            clientId: s.clientId,
                            projectId: s.projectId,
                            source: "learned",
                          });
                        }
                      } else {
                        // Auto-pick if 1 project, else open project picker
                        handleSelectClient(s.clientId);
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-700"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-900 dark:text-white">
                        {s.clientName}
                      </span>
                      {s.projectName && (
                        <span className="ml-1.5 text-xs text-gray-400">
                          {s.projectName}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300">
                      {t("picker.match")}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* All clients */}
        <p className="mt-3 text-xs font-medium text-gray-600 dark:text-gray-300">
          {searchQuery ? t("picker.searchResults") : t("picker.allClients")}
        </p>
        <div className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
          {filteredClients
            .slice(0, 15)
            .map((c: { id: string; name: string }) => (
              <button
                key={c.id}
                type="button"
                disabled={createEntry.isPending}
                onClick={() => handleSelectClient(c.id)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-700"
              >
                <span className="font-medium text-gray-900 dark:text-white">
                  {c.name}
                </span>
              </button>
            ))}
          {filteredClients.length === 0 && (
            <p className="py-4 text-center text-xs text-gray-400">
              {t("picker.noClients")}
            </p>
          )}

          {/* Intern tid — no client, no project */}
          {!searchQuery && (
            <button
              type="button"
              disabled={createEntry.isPending}
              onClick={() => {
                createEntry.mutate({
                  eventId: block.rawId,
                  description: block.title,
                  isBillable: false,
                });
              }}
              className="flex w-full items-center gap-2 rounded-md border border-dashed border-gray-200 px-2.5 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {t("picker.internal")}
            </button>
          )}
        </div>

        {/* Remember choice checkbox */}
        <label className="mt-3 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
          />
          {t("picker.remember")}
        </label>

        {createEntry.isPending && (
          <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-gray-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t("picker.creating")}
          </div>
        )}
      </div>
    </div>
  );
}
