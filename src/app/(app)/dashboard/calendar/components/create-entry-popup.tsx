import { Loader2, Play, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { ProjectSelect } from "@/components/ui/ProjectSelect";
import { switchThumb, switchTrack } from "@/components/ui/switch-styles";
import { TaskSelect } from "@/components/ui/TaskSelect";
import { useModules } from "@/hooks/useModules";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";
import { formatDuration, minutesToDate } from "../utils/calendar-math";

interface CreateEntryPopupProps {
  date: Date;
  startMinutes: number;
  endMinutes: number;
  /** If converting from a Google Calendar event */
  fromEvent?: {
    eventId: string;
    title: string;
    matchedClientId?: string;
  };
  onClose: () => void;
}

export function CreateEntryPopup({
  date,
  startMinutes,
  endMinutes,
  fromEvent,
  onClose,
}: CreateEntryPopupProps) {
  const fid = useId();
  const t = useTranslations("calendar");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const [clientId, setClientId] = useState<string | null>(
    fromEvent?.matchedClientId ?? null,
  );
  const [projectId, setProjectId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [description, setDescription] = useState(fromEvent?.title ?? "");
  const [isBillable, setIsBillable] = useState(true);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientInputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: allClients } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });
  const { data: allProjects } = trpc.projects.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("projects"),
  });
  const { data: tasksList } = trpc.tasks.listForTime.useQuery(undefined);
  const { data: recentEntries } = trpc.time.getRecent.useQuery({ limit: 10 });

  // "Continue" mode — create a new entry pre-filled from a recent entry
  const [continueEntryId, setContinueEntryId] = useState<string | null>(null);

  const createEntry = trpc.time.create.useMutation({
    onSuccess: () => {
      // Name the date — calendar entries are often backdated, and the time
      // page's default filter can hide them, which reads as "it disappeared".
      toast.success(
        t("create.created", {
          date: date.toLocaleDateString(toIntlLocale(locale), {
            day: "numeric",
            month: "short",
          }),
        }),
      );
      utils.time.list.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const createFromEvent = trpc.calendar.createTimeEntryFromEvent.useMutation({
    onSuccess: (data) => {
      toast.success(
        t("create.registered", {
          hours: data.hours,
          title: fromEvent?.title ?? "",
        }),
      );
      utils.calendar.getEvents.invalidate();
      utils.time.list.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  // Filter clients by search
  const filteredClients = useMemo(() => {
    if (!allClients) return [];
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle types vary
    const active = (allClients as any[]).filter(
      (c: { isArchived: boolean | null }) => !c.isArchived,
    );
    if (!clientSearch) return active;
    return active.filter((c: { name: string }) =>
      c.name.toLowerCase().includes(clientSearch.toLowerCase()),
    );
  }, [allClients, clientSearch]);

  // Filter projects for selected client
  const clientProjectsList = useMemo(() => {
    if (!clientId || !allProjects) return [];
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle types vary
    return (allProjects as any[]).filter(
      (p: { clientId: string; status: string | null }) =>
        p.clientId === clientId && p.status === "active",
    );
  }, [allProjects, clientId]);

  // Auto-select project if only one
  useEffect(() => {
    if (clientProjectsList.length === 1) {
      setProjectId(clientProjectsList[0].id);
    } else {
      setProjectId(null);
    }
  }, [clientProjectsList]);

  // Escape to close (click-outside is handled by parent overlay)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const startTime = minutesToDate(date, startMinutes);
  const endTime = minutesToDate(date, endMinutes);
  // Reelle minutter mellem tidspunkterne (sommertidsnætter giver ±60)
  const durationMinutes = Math.round(
    (endTime.getTime() - startTime.getTime()) / 60_000,
  );
  const hours = durationMinutes / 60;

  const startLabel = `${String(startTime.getHours()).padStart(2, "0")}:${String(startTime.getMinutes()).padStart(2, "0")}`;
  const endLabel = `${String(endTime.getHours()).padStart(2, "0")}:${String(endTime.getMinutes()).padStart(2, "0")}`;
  const dateLabel = date.toLocaleDateString(toIntlLocale(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  const selectedClientName = useMemo(() => {
    if (!clientId || !allClients) return null;
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle types vary
    const client = (allClients as any[]).find(
      (c: { id: string }) => c.id === clientId,
    );
    return client?.name;
  }, [clientId, allClients]);

  const handleSubmit = useCallback(() => {
    if (continueEntryId) {
      // Create a NEW entry pre-filled from the selected recent entry
      // (not a segment — segments are for same-session continuation,
      // calendar blocks are distinct work periods that should be visible)
      const recentEntry = recentEntries?.find(
        (e) => e.entryId === continueEntryId,
      );
      createEntry.mutate({
        description:
          recentEntry?.description ||
          description ||
          t("create.defaultDescription"),
        hours: Math.round(hours * 100) / 100,
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        clientId: recentEntry?.clientId || undefined,
        projectId: recentEntry?.projectId || undefined,
        taskId: recentEntry?.taskId || undefined,
        isBillable: true,
      });
      return;
    }

    if (fromEvent) {
      createFromEvent.mutate({
        eventId: fromEvent.eventId,
        clientId: clientId || undefined,
        projectId: projectId || undefined,
      });
      return;
    }

    createEntry.mutate({
      description: description || t("create.defaultDescription"),
      hours: Math.round(hours * 100) / 100,
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      clientId: clientId || undefined,
      projectId: projectId || undefined,
      taskId: selectedTaskId || undefined,
      isBillable,
    });
  }, [
    continueEntryId,
    recentEntries,
    fromEvent,
    createEntry,
    createFromEvent,
    description,
    hours,
    date,
    startTime,
    endTime,
    clientId,
    projectId,
    selectedTaskId,
    isBillable,
    t,
  ]);

  const isPending = createEntry.isPending || createFromEvent.isPending;

  return (
    <div
      ref={popupRef}
      className="w-72 rounded-xl border border-gray-200/80 bg-white p-4 shadow-xl dark:border-gray-800 dark:bg-gray-900"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("create.title")}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {dateLabel} · {startLabel}–{endLabel} ·{" "}
            {formatDuration(durationMinutes, {
              hour: t("units.hour"),
              minute: t("units.minute"),
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Recent entries — quick continue */}
      {recentEntries && recentEntries.length > 0 && !fromEvent && (
        <div className="mb-3">
          <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            {t("create.continueFromRecent")}
          </span>
          <div className="max-h-32 overflow-y-auto space-y-0.5 rounded-lg border border-gray-200 dark:border-gray-700 p-1">
            {recentEntries.map((entry) => (
              <button
                key={entry.entryId}
                type="button"
                onClick={() => {
                  if (continueEntryId === entry.entryId) {
                    setContinueEntryId(null);
                    setDescription("");
                    setClientId(null);
                    setProjectId(null);
                  } else {
                    setContinueEntryId(entry.entryId);
                    setDescription(entry.description);
                    setClientId(entry.clientId);
                    setProjectId(entry.projectId);
                  }
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                  continueEntryId === entry.entryId
                    ? "bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400 ring-1 ring-brand-300 dark:ring-brand-700"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                <Play className="h-3 w-3 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {entry.description || t("create.noDescription")}
                  </span>
                  {(entry.clientName || entry.projectName) && (
                    <span className="block truncate text-[10px] text-gray-400">
                      {[entry.clientName, entry.projectName]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
          {continueEntryId && (
            <p className="mt-1 text-[10px] text-brand-600 dark:text-brand-400">
              {t("create.willCopy")}
            </p>
          )}
        </div>
      )}

      {/* Divider when in continue mode */}
      {continueEntryId && (
        <div className="mb-3 flex items-center gap-2">
          <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
          <span className="text-[10px] text-gray-400 uppercase">
            {t("create.orCreateNew")}
          </span>
          <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
          <button
            type="button"
            onClick={() => {
              setContinueEntryId(null);
              setDescription(fromEvent?.title ?? "");
              setClientId(fromEvent?.matchedClientId ?? null);
              setProjectId(null);
            }}
            className="text-[10px] text-brand-600 hover:text-brand-700 dark:text-brand-400"
          >
            {t("create.reset")}
          </button>
        </div>
      )}

      {/* Client */}
      <div
        className={`mb-3 ${continueEntryId ? "opacity-50 pointer-events-none" : ""}`}
      >
        <label
          htmlFor={`${fid}-f1`}
          className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
        >
          {t("create.client")}
        </label>
        <div className="relative">
          <input
            id={`${fid}-f1`}
            ref={clientInputRef}
            type="text"
            placeholder={t("create.internalTime")}
            value={clientId ? selectedClientName || "" : clientSearch}
            onChange={(e) => {
              setClientSearch(e.target.value);
              setClientId(null);
              setShowClientDropdown(true);
            }}
            onFocus={() => setShowClientDropdown(true)}
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          />
          {showClientDropdown && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
              <button
                type="button"
                onClick={() => {
                  setClientId(null);
                  setClientSearch("");
                  setShowClientDropdown(false);
                }}
                className="flex w-full px-3 py-1.5 text-left text-xs text-gray-400 italic hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                {t("create.internalTime")}
              </button>
              {filteredClients.map((c: { id: string; name: string }) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setClientId(c.id);
                    setClientSearch("");
                    setShowClientDropdown(false);
                  }}
                  className="flex w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-600"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Project */}
      {allProjects && allProjects.length > 0 && (
        <div
          className={`mb-3 ${continueEntryId ? "opacity-50 pointer-events-none" : ""}`}
        >
          <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            {t("create.projectOptional")}
          </span>
          <ProjectSelect
            // biome-ignore lint/suspicious/noExplicitAny: Drizzle types vary
            projects={allProjects as any[]}
            value={projectId}
            onChange={(id) => {
              setProjectId(id);
              // Auto-fill the description with the project name when empty, so
              // users don't retype it every time.
              if (id && !description.trim()) {
                const proj = (
                  allProjects as Array<{ id: string; name: string }>
                ).find((p) => p.id === id);
                if (proj?.name) setDescription(proj.name);
              }
            }}
            clientId={clientId}
            placeholder={t("create.noProject")}
          />
        </div>
      )}

      {/* Task */}
      <div
        className={`mb-3 ${continueEntryId ? "opacity-50 pointer-events-none" : ""}`}
      >
        <span className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
          {t("create.linkTask")}
        </span>
        <TaskSelect
          tasks={tasksList}
          value={selectedTaskId}
          onChange={setSelectedTaskId}
          clientId={clientId}
          placeholder={t("create.noTask")}
        />
      </div>

      {/* Description */}
      <div
        className={`mb-3 ${continueEntryId ? "opacity-50 pointer-events-none" : ""}`}
      >
        <label
          htmlFor={`${fid}-f2`}
          className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1"
        >
          {t("create.description")}
        </label>
        <input
          id={`${fid}-f2`}
          type="text"
          placeholder={t("create.descriptionPlaceholder")}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
        />
      </div>

      {/* Billable toggle */}
      <div
        className={`flex items-center gap-2 mb-4 ${continueEntryId ? "opacity-50 pointer-events-none" : ""}`}
      >
        <button
          type="button"
          onClick={() => setIsBillable(!isBillable)}
          role="switch"
          aria-checked={isBillable}
          aria-label={t("create.billable")}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tt-fokus ${switchTrack(isBillable)}`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${switchThumb(isBillable)} ${
              isBillable ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {t("create.billable")}
        </span>
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={isPending}
        className="w-full rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
        ) : continueEntryId ? (
          t("create.createFromRecent")
        ) : (
          t("create.createEntry")
        )}
      </button>
    </div>
  );
}
