"use client";

import {
  Bookmark,
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  DollarSign,
  Edit2,
  FileSpreadsheet,
  Filter,
  FolderKanban,
  Grid3x3,
  List,
  Play,
  Plus,
  Ticket,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { PomodoroTimer, TimerWidget } from "@/components/timer";
import { Button, ClientSearchCombobox, ConfirmDialog } from "@/components/ui";
import { ProjectSelect } from "@/components/ui/ProjectSelect";
import { useDebounce } from "@/hooks/useDebounce";
import { useModules } from "@/hooks/useModules";
import { useServerValue } from "@/hooks/useServerValue";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  dkkCurrencyFormatter,
  formatTime as formatHoursToTime,
  toLocalDateStr,
} from "@/lib/format";
import { canPreviewRate } from "@/lib/time/preview-rate";
import { toastError } from "@/lib/trpc/error-toast";
import { trpc } from "@/providers/trpc-provider";
import {
  type TimeListGroupBy,
  useTimeListPreferences,
} from "@/stores/timeListPreferencesStore";
import { useTimerStore } from "@/stores/timerStore";
import {
  type DateRangePreset,
  getDateRangeForPreset,
} from "./date-range-presets";

// Monteres kun på brugerhandling (redigering, "Værktøjer"-panelet eller
// ugeseddel-visningen) — hentes derfor først når de skal bruges, så bl.a.
// zod (via redigeringsmodalens formular) ikke er med i sidens første load.
const TimeEntryEditModal = dynamic(() =>
  import("@/components/TimeEntryEditModal").then((m) => m.TimeEntryEditModal),
);
const AITimeSuggestions = dynamic(() =>
  import("@/components/time/AITimeSuggestions").then(
    (m) => m.AITimeSuggestions,
  ),
);
const ProductivityInsights = dynamic(() =>
  import("@/components/time/ProductivityInsights").then(
    (m) => m.ProductivityInsights,
  ),
);
const TimelineView = dynamic(() =>
  import("@/components/time/TimelineView").then((m) => m.TimelineView),
);
const WeeklyTimesheetView = dynamic(() =>
  import("@/components/time/WeeklyTimesheetView").then(
    (m) => m.WeeklyTimesheetView,
  ),
);
// Altid monteret, men renderer null indtil de åbnes — kun klient-side, så
// deres kode (inkl. skabelonformularens zod/react-hook-form) hentes efter
// hydrering i stedet for i sidens første load.
const BulkAssignPrepaidModal = dynamic(
  () =>
    import("@/components/klippekort/BulkAssignPrepaidModal").then(
      (m) => m.BulkAssignPrepaidModal,
    ),
  { ssr: false },
);
const SaveAsTemplateModal = dynamic(
  () =>
    import("@/components/templates/SaveAsTemplateModal").then(
      (m) => m.SaveAsTemplateModal,
    ),
  { ssr: false },
);
const CSVImportModal = dynamic(
  () =>
    import("@/components/time/CSVImportModal").then((m) => m.CSVImportModal),
  { ssr: false },
);

// Generic grouping types
type GroupableEntry = {
  date: string | Date;
  hours: string;
  description?: string | null;
  client?: { id: string; name: string } | null;
  project?: {
    id: string;
    name: string;
    client?: { id: string; name: string } | null;
  } | null;
  tags?: { id: string; name: string; color: string | null }[] | null;
  task?: { id: string; title: string } | null;
  taskId?: string | null;
};

interface GroupLabels {
  all: string;
  noClient: string;
  noProject: string;
  noTags: string;
  noTask: string;
  today: string;
  yesterday: string;
  locale: string;
}

interface GroupedEntriesResult<T> {
  groupKey: string;
  groupLabel: string;
  groupColor?: string | null;
  totalHours: number;
  entryCount: number;
  entries: T[];
}

function groupEntries<T extends GroupableEntry>(
  entries: T[],
  groupBy: TimeListGroupBy,
  labels: GroupLabels,
): GroupedEntriesResult<T>[] {
  if (groupBy === "none") {
    const total = entries.reduce(
      (sum, e) => sum + Number.parseFloat(e.hours || "0"),
      0,
    );
    return [
      {
        groupKey: "all",
        groupLabel: labels.all,
        totalHours: total,
        entryCount: entries.length,
        entries,
      },
    ];
  }

  if (groupBy === "date") {
    const map = new Map<string, GroupedEntriesResult<T>>();
    for (const e of entries) {
      const dateKey =
        typeof e.date === "string"
          ? e.date.split("T")[0]
          : toLocalDateStr(e.date);
      let group = map.get(dateKey);
      if (!group) {
        group = {
          groupKey: dateKey,
          groupLabel: formatDayHeader(dateKey, labels),
          totalHours: 0,
          entryCount: 0,
          entries: [],
        };
        map.set(dateKey, group);
      }
      group.entries.push(e);
      group.entryCount++;
      group.totalHours += Number.parseFloat(e.hours || "0");
    }
    return Array.from(map.values()).sort((a, b) =>
      b.groupKey.localeCompare(a.groupKey),
    );
  }

  if (groupBy === "client") {
    const map = new Map<string, GroupedEntriesResult<T>>();
    for (const e of entries) {
      const clientId = e.client?.id ?? e.project?.client?.id ?? "none";
      const clientName =
        e.client?.name ?? e.project?.client?.name ?? labels.noClient;
      let group = map.get(clientId);
      if (!group) {
        group = {
          groupKey: clientId,
          groupLabel: clientName,
          totalHours: 0,
          entryCount: 0,
          entries: [],
        };
        map.set(clientId, group);
      }
      group.entries.push(e);
      group.entryCount++;
      group.totalHours += Number.parseFloat(e.hours || "0");
    }
    return Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours);
  }

  if (groupBy === "project") {
    const map = new Map<string, GroupedEntriesResult<T>>();
    for (const e of entries) {
      const projectId = e.project?.id ?? "none";
      const projectName = e.project?.name ?? labels.noProject;
      let group = map.get(projectId);
      if (!group) {
        group = {
          groupKey: projectId,
          groupLabel: projectName,
          totalHours: 0,
          entryCount: 0,
          entries: [],
        };
        map.set(projectId, group);
      }
      group.entries.push(e);
      group.entryCount++;
      group.totalHours += Number.parseFloat(e.hours || "0");
    }
    return Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours);
  }

  if (groupBy === "tag") {
    const map = new Map<string, GroupedEntriesResult<T>>();
    for (const e of entries) {
      const tags = e.tags ?? [];
      if (tags.length === 0) {
        const key = "untagged";
        let group = map.get(key);
        if (!group) {
          group = {
            groupKey: key,
            groupLabel: labels.noTags,
            totalHours: 0,
            entryCount: 0,
            entries: [],
          };
          map.set(key, group);
        }
        group.entries.push(e);
        group.entryCount++;
        group.totalHours += Number.parseFloat(e.hours || "0");
        continue;
      }
      for (const tag of tags) {
        let group = map.get(tag.id);
        if (!group) {
          group = {
            groupKey: tag.id,
            groupLabel: tag.name,
            groupColor: tag.color,
            totalHours: 0,
            entryCount: 0,
            entries: [],
          };
          map.set(tag.id, group);
        }
        group.entries.push(e);
        group.entryCount++;
        group.totalHours += Number.parseFloat(e.hours || "0");
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours);
  }

  if (groupBy === "task") {
    const map = new Map<string, GroupedEntriesResult<T>>();
    for (const e of entries) {
      const taskId = e.task?.id ?? e.taskId;
      const cId = e.client?.id ?? e.project?.client?.id;
      const projId = e.project?.id;
      const desc = e.description ?? "";
      // Group key: taskId first, then client+project+description fallback
      const key = taskId
        ? `task:${taskId}`
        : `${cId ?? "no-client"}:${projId ?? ""}:${desc}`;
      const label = taskId
        ? (e.task?.title ?? labels.noTask)
        : desc || e.project?.name || labels.noTask;
      let group = map.get(key);
      if (!group) {
        group = {
          groupKey: key,
          groupLabel: label,
          totalHours: 0,
          entryCount: 0,
          entries: [],
        };
        map.set(key, group);
      }
      group.entries.push(e);
      group.entryCount++;
      group.totalHours += Number.parseFloat(e.hours || "0");
    }
    return Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours);
  }

  return [];
}

function formatDayHeader(dateStr: string, labels: GroupLabels): string {
  const date = new Date(`${dateStr}T12:00:00`); // Avoid timezone issues
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = dateStr === toLocalDateStr(today);
  const isYesterday = dateStr === toLocalDateStr(yesterday);

  if (isToday) return labels.today;
  if (isYesterday) return labels.yesterday;

  return date.toLocaleDateString(toIntlLocale(labels.locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// Inline editable hours component with optimistic updates
function InlineHoursEdit({
  entryId,
  initialHours,
  projectId,
  clientId,
  onSuccess,
}: {
  entryId: string;
  initialHours: string;
  projectId?: string | null;
  clientId?: string | null;
  onSuccess: () => void;
}) {
  const t = useTranslations("time");
  const [isEditing, setIsEditing] = useState(false);
  const [showRatePreview, setShowRatePreview] = useState(false);
  const [value, setValue] = useState(initialHours);
  // Serverens værdi, eller den optimistiske indtil refetch — aldrig en
  // forældet kopi fra første mount (audit A5, P1-3).
  const [displayValue, setDisplayValue] = useServerValue(initialHours);
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  // Fetch rate for preview
  const hours = parseFloat(displayValue) || 0;
  const { data: ratePreview } = trpc.time.previewRate.useQuery(
    {
      projectId: projectId || null,
      clientId: clientId || null,
      hours,
    },
    { enabled: canPreviewRate(hours) },
  );

  const quickUpdateMutation = trpc.time.quickUpdateHours.useMutation({
    // Optimistic update: update UI immediately
    onMutate: async ({ hours }) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await utils.time.list.cancel();

      // Update display value optimistically
      setDisplayValue(hours.toString());
      setIsEditing(false);
    },
    onSuccess: () => {
      toast.success(t("inline.hoursUpdated"));
      // Editing hours can change a klippekort deduction, so refresh prepaid
      // balances too.
      utils.prepaid.getActiveForClient.invalidate();
      onSuccess();
    },
    onError: (error, variables) => {
      toastError(error, t("inline.hoursUpdateFailed"), () => {
        quickUpdateMutation.mutate(variables);
      });
    },
    // Hent listen og vis derefter serverens (evt. normaliserede) værdi —
    // også når den ender som den gamle streng. Ved fejl: rul tilbage.
    onSettled: async () => {
      await utils.time.list.invalidate();
      setDisplayValue(null);
    },
  });

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const hours = parseFloat(value);
    if (Number.isNaN(hours) || hours < 0.01) {
      toast.error(t("inline.hoursInvalid"));
      setValue(displayValue);
      setIsEditing(false);
      return;
    }
    quickUpdateMutation.mutate({ id: entryId, hours });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setValue(displayValue);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="number"
          step="0.25"
          min="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="w-16 rounded-lg border border-brand-300 dark:border-brand-700 bg-white dark:bg-gray-900 px-2 py-1 text-right tabular-nums text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <span className="text-gray-500">{t("inline.hoursUnit")}</span>
      </div>
    );
  }

  // Format currency for rate preview
  const formatCurrency = (amount: number) =>
    dkkCurrencyFormatter.format(amount);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setValue(displayValue);
          setIsEditing(true);
        }}
        onMouseEnter={() => setShowRatePreview(true)}
        onMouseLeave={() => setShowRatePreview(false)}
        onFocus={() => setShowRatePreview(true)}
        onBlur={() => setShowRatePreview(false)}
        className={`text-sm tabular-nums font-semibold hover:text-brand-600 dark:hover:text-brand-400 cursor-pointer ${
          quickUpdateMutation.isPending
            ? "text-gray-400 dark:text-gray-500"
            : "text-gray-900 dark:text-white"
        }`}
        title={t("inline.clickToEdit")}
        disabled={quickUpdateMutation.isPending}
      >
        {formatHoursToTime(displayValue)}
      </button>

      {/* Rate preview tooltip */}
      {showRatePreview && ratePreview && ratePreview.hourlyRate > 0 && (
        <div className="absolute right-0 top-full mt-1 z-20 whitespace-nowrap rounded-lg bg-gray-900 dark:bg-gray-700 px-3 py-2 text-xs text-white shadow-lg animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <DollarSign className="h-3 w-3 text-green-400" />
            <span>{formatCurrency(ratePreview.totalValue)}</span>
          </div>
          <div className="mt-1 text-gray-400 text-[10px]">
            {t("inline.ratePerHour", {
              rate: formatCurrency(ratePreview.hourlyRate),
            })}
            {ratePreview.rateSource && (
              <span className="ml-1">• {ratePreview.rateSourceName}</span>
            )}
          </div>
          <div className="absolute -top-1 right-4 h-2 w-2 rotate-45 bg-gray-900 dark:bg-gray-700" />
        </div>
      )}
    </div>
  );
}

// Inline editable description component with optimistic updates
function InlineDescriptionEdit({
  entryId,
  initialDescription,
  onSuccess,
}: {
  entryId: string;
  initialDescription: string;
  onSuccess: () => void;
}) {
  const t = useTranslations("time");
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(initialDescription);
  const [displayValue, setDisplayValue] = useServerValue(initialDescription);
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const quickUpdateMutation = trpc.time.quickUpdateDescription.useMutation({
    // Optimistic update: update UI immediately
    onMutate: async ({ description }) => {
      await utils.time.list.cancel();
      setDisplayValue(description);
      setIsEditing(false);
    },
    onSuccess: () => {
      toast.success(t("inline.descriptionUpdated"));
      onSuccess();
    },
    onError: (error, variables) => {
      toastError(error, t("inline.descriptionUpdateFailed"), () => {
        quickUpdateMutation.mutate(variables);
      });
    },
    onSettled: async () => {
      await utils.time.list.invalidate();
      setDisplayValue(null);
    },
  });

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (!value.trim()) {
      toast.error(t("inline.descriptionEmpty"));
      setValue(displayValue);
      setIsEditing(false);
      return;
    }
    if (value !== displayValue) {
      quickUpdateMutation.mutate({ id: entryId, description: value.trim() });
    } else {
      setIsEditing(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setValue(displayValue);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        className="w-full rounded-lg border border-brand-300 dark:border-brand-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(displayValue);
        setIsEditing(true);
      }}
      className={`text-sm font-medium hover:text-brand-600 dark:hover:text-brand-400 cursor-pointer text-left ${
        quickUpdateMutation.isPending
          ? "text-gray-400 dark:text-gray-500"
          : "text-gray-900 dark:text-white"
      }`}
      title={t("inline.clickToEdit")}
      disabled={quickUpdateMutation.isPending}
    >
      {displayValue}
    </button>
  );
}

export default function TimePage() {
  const t = useTranslations("time");
  const tc = useTranslations("common");
  const locale = useLocale();
  const groupLabels: GroupLabels = {
    all: t("group.all"),
    noClient: t("group.noClient"),
    noProject: t("group.noProject"),
    noTags: t("group.noTags"),
    noTask: t("group.noTask"),
    today: t("group.today"),
    yesterday: t("group.yesterday"),
    locale,
  };
  const router = useRouter();
  const searchParams = useSearchParams();
  const [_showAddForm, _setShowAddForm] = useState(false);

  // Date range state — initialize from URL or default
  const urlPreset = searchParams.get("range") as DateRangePreset | null;
  const initialPreset =
    urlPreset && urlPreset !== "custom" ? urlPreset : "thisWeek";
  const initialRange =
    urlPreset === "custom"
      ? {
          start:
            searchParams.get("from") || getDateRangeForPreset("thisWeek").start,
          end: searchParams.get("to") || getDateRangeForPreset("thisWeek").end,
        }
      : getDateRangeForPreset(initialPreset);

  const [dateRangePreset, setDateRangePreset] = useState<DateRangePreset>(
    urlPreset || "thisWeek",
  );
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(
    new Set(),
  );
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [showMoveToProject, setShowMoveToProject] = useState(false);
  const [showAssignPrepaid, setShowAssignPrepaid] = useState(false);
  const groupBy = useTimeListPreferences((s) => s.groupBy);
  const setGroupBy = useTimeListPreferences((s) => s.setGroupBy);
  const [deleteConfirmEntry, setDeleteConfirmEntry] = useState<string | null>(
    null,
  );
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Gemte standardfiltre gælder kun når URL'en ikke selv har filter-params
  // (et delt link skal vise præcis det, linket siger)
  const urlHasFilters = !!(
    searchParams.get("project") ||
    searchParams.get("client") ||
    searchParams.get("billed") ||
    searchParams.get("billable")
  );
  const savedDefaultFilters = useTimeListPreferences((s) => s.defaultFilters);
  const setSavedDefaultFilters = useTimeListPreferences(
    (s) => s.setDefaultFilters,
  );
  const [initialDefaults] = useState(() =>
    urlHasFilters ? null : savedDefaultFilters,
  );
  const [filterProjectId, setFilterProjectId] = useState<string>(
    searchParams.get("project") || initialDefaults?.projectId || "",
  );
  const [filterClientId, setFilterClientId] = useState<string>(
    searchParams.get("client") || initialDefaults?.clientId || "",
  );
  const [filterBilledStatus, setFilterBilledStatus] = useState<
    "" | "billed" | "unbilled"
  >(
    (searchParams.get("billed") as "" | "billed" | "unbilled") ||
      initialDefaults?.billedStatus ||
      "",
  );
  const [filterBillableStatus, setFilterBillableStatus] = useState<
    "" | "billable" | "non-billable"
  >(
    (searchParams.get("billable") as "" | "billable" | "non-billable") ||
      initialDefaults?.billableStatus ||
      "",
  );
  const [filterMemberId, setFilterMemberId] = useState("");
  // Default: vis kun egne poster. Owner/admin kan slå hele teamet til.
  const [showTeamTime, setShowTeamTime] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [templateEntry, setTemplateEntry] = useState<{
    description: string;
    projectId: string | null;
    clientId: string | null;
    hours: string;
  } | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "timesheet">(
    (searchParams.get("view") as "list" | "timesheet") || "list",
  );

  // Auto-open filter panel if URL has filter params or saved defaults apply
  const [filtersInitialized] = useState(
    () =>
      urlHasFilters ||
      !!(
        initialDefaults &&
        (initialDefaults.projectId ||
          initialDefaults.clientId ||
          initialDefaults.billedStatus ||
          initialDefaults.billableStatus)
      ),
  );
  useEffect(() => {
    if (filtersInitialized) setShowFilters(true);
  }, [filtersInitialized]);

  // Sync filters to URL (debounced)
  const debouncedPreset = useDebounce(dateRangePreset, 300);
  const debouncedProject = useDebounce(filterProjectId, 300);
  const debouncedClient = useDebounce(filterClientId, 300);
  const debouncedBilled = useDebounce(filterBilledStatus, 300);
  const debouncedBillable = useDebounce(filterBillableStatus, 300);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedPreset !== "thisWeek") params.set("range", debouncedPreset);
    if (debouncedPreset === "custom") {
      params.set("from", startDate);
      params.set("to", endDate);
    }
    if (debouncedProject) params.set("project", debouncedProject);
    if (debouncedClient) params.set("client", debouncedClient);
    if (debouncedBilled) params.set("billed", debouncedBilled);
    if (debouncedBillable) params.set("billable", debouncedBillable);
    if (viewMode !== "list") params.set("view", viewMode);
    const paramStr = params.toString();
    const newUrl = paramStr ? `/dashboard/time?${paramStr}` : "/dashboard/time";
    router.replace(newUrl, { scroll: false });
  }, [
    debouncedPreset,
    debouncedProject,
    debouncedClient,
    debouncedBilled,
    debouncedBillable,
    startDate,
    endDate,
    viewMode,
    router,
  ]);

  const continueEntry = useTimerStore((s) => s.continueEntry);
  const startTimer = useTimerStore((s) => s.startTimer);
  const isRunning = useTimerStore((s) => s.isRunning);
  const elapsedTime = useTimerStore((s) => s.elapsedTime);

  const pageUtils = trpc.useUtils();
  const { isEnabled: isModuleEnabled, isPlaceholder: modulesPlaceholder } =
    useModules();
  const { data: clients } = trpc.clients.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("clients"),
  });
  const { data: projects } = trpc.projects.list.useQuery(undefined, {
    enabled: !modulesPlaceholder && isModuleEnabled("projects"),
  });
  const { data: orgMembers } = trpc.organization.getMembers.useQuery();

  // Pagination state
  const PAGE_SIZE = 25;
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const {
    data: timeEntriesData,
    refetch,
    isFetching,
    isLoading: timeEntriesLoading,
    error: timeEntriesError,
  } = trpc.time.list.useQuery({
    startDate,
    endDate,
    projectId: filterProjectId || undefined,
    clientId: filterClientId || undefined,
    isBilled:
      filterBilledStatus === "billed"
        ? true
        : filterBilledStatus === "unbilled"
          ? false
          : undefined,
    isBillable:
      filterBillableStatus === "billable"
        ? true
        : filterBillableStatus === "non-billable"
          ? false
          : undefined,
    onlyOwn: !showTeamTime,
    memberId: showTeamTime ? filterMemberId || undefined : undefined,
    limit: PAGE_SIZE,
    cursor,
  });

  // Type for entries - extracted from query result
  type TimeEntry = NonNullable<typeof timeEntriesData>["entries"][number];
  const [allEntries, setAllEntries] = useState<TimeEntry[]>([]);

  // Reset pagination when filters change
  // Nulstil pagination når team-scope/medarbejder skifter (datasættet ændres).
  // biome-ignore lint/correctness/useExhaustiveDependencies: showTeamTime og filterMemberId er udløsere: listen nulstilles, når visningen skifter
  useEffect(() => {
    setCursor(undefined);
    setAllEntries([]);
  }, [showTeamTime, filterMemberId]);

  // Merge entries when data changes
  useEffect(() => {
    if (timeEntriesData?.entries) {
      if (cursor) {
        // Append new entries
        setAllEntries((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const newEntries = timeEntriesData.entries.filter(
            (e) => !existingIds.has(e.id),
          );
          return [...prev, ...newEntries];
        });
      } else {
        // Fresh data (no cursor = first page)
        setAllEntries(timeEntriesData.entries);
      }
    }
  }, [timeEntriesData?.entries, cursor]);

  // Use merged entries for display, normalizing Drizzle relation types
  const timeEntries = allEntries.map((entry) => {
    const project = Array.isArray(entry.project)
      ? entry.project[0]
      : entry.project;
    const client = Array.isArray(entry.client) ? entry.client[0] : entry.client;
    return {
      ...entry,
      project: project
        ? {
            ...project,
            client: project.client
              ? Array.isArray(project.client)
                ? project.client[0]
                : project.client
              : null,
          }
        : null,
      client,
    };
  });
  const hasMore = timeEntriesData?.hasMore ?? false;

  const loadMore = () => {
    if (timeEntriesData?.nextCursor) {
      setCursor(timeEntriesData.nextCursor);
    }
  };

  // Wrapper to refetch and reset pagination
  const refetchEntries = () => {
    setCursor(undefined);
    setAllEntries([]);
    refetch();
  };

  // Handle date range preset change
  const handleDateRangePresetChange = (preset: DateRangePreset) => {
    setDateRangePreset(preset);
    if (preset !== "custom") {
      const range = getDateRangeForPreset(preset);
      setStartDate(range.start);
      setEndDate(range.end);
    }
  };

  // Handle custom date change
  const handleCustomDateChange = (type: "start" | "end", value: string) => {
    setDateRangePreset("custom");
    if (type === "start") {
      setStartDate(value);
      // Ensure end date is not before start date
      if (value > endDate) {
        setEndDate(value);
      }
    } else {
      setEndDate(value);
    }
  };
  const deleteMutation = trpc.time.delete.useMutation({
    onSuccess: () => {
      // Sletning refunderer evt. klippekort-timer — opdater saldi overalt
      pageUtils.prepaid.invalidate();
      refetchEntries();
    },
    onError: (error, variables) => {
      toastError(error, t("page.deleteFailed"), () => {
        deleteMutation.mutate(variables);
      });
    },
  });
  const restoreMutation = trpc.time.create.useMutation({
    onSuccess: () => {
      toast.success(t("page.restored"));
      pageUtils.prepaid.invalidate();
      refetchEntries();
    },
    onError: (error) => {
      toastError(error, t("page.restoreFailed"));
    },
  });
  // Snapshot til "Fortryd" — genskaber via time.create, så klippekort-træk
  // og task-tid genberegnes symmetrisk med refusionen ved sletning
  const buildRestorePayload = (entry: (typeof timeEntries)[number]) => ({
    projectId: entry.projectId ?? undefined,
    clientId: entry.clientId ?? undefined,
    description: entry.description?.trim() || t("page.restoredDescription"),
    notes: entry.notes ?? undefined,
    hours: Number(entry.hours),
    date: toLocalDateStr(new Date(entry.date)),
    isBillable: entry.isBillable ?? undefined,
    isBilled: entry.isBilled ?? undefined,
    taskId: entry.taskId ?? undefined,
    billableRate: entry.billableRate ?? undefined,
    prepaidPackageId:
      entry.isPrepaid && entry.prepaidPackageId
        ? entry.prepaidPackageId
        : undefined,
  });
  // Eksport til Google Kalender kræver skriveadgang (calendar.events), som
  // brugeren selv giver under Integrationer (#678).
  const { data: calendarStatus } = trpc.calendar.getConnectionStatus.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 },
  );
  const exportToCalendarMutation = trpc.calendar.exportTimeEntry.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(t("page.calendarExported"));
      } else {
        toast.error(result.error || t("page.calendarExportFailed"));
      }
    },
    onError: (error) => {
      toast.error(error.message || t("page.calendarExportFailed"), {
        action: {
          label: t("page.grantWriteAccess"),
          onClick: () => router.push("/dashboard/settings/integrations"),
        },
      });
    },
  });
  const duplicateMutation = trpc.time.duplicate.useMutation({
    onSuccess: () => {
      toast.success(t("page.duplicatedToday"));
      refetchEntries();
    },
    onError: (error) => {
      toastError(error, t("page.duplicateFailed"));
    },
  });
  const bulkDeleteMutation = trpc.time.bulkDelete.useMutation({
    onSuccess: (data) => {
      toast.success(t("page.bulkDeleted", { count: data.count }));
      setSelectedEntries(new Set());
      setShowBulkActions(false);
      pageUtils.prepaid.invalidate();
      refetchEntries();
    },
    onError: (error, variables) => {
      toastError(error, t("page.bulkDeleteFailed"), () => {
        bulkDeleteMutation.mutate(variables);
      });
    },
  });
  const bulkMarkBilledMutation = trpc.time.bulkMarkBilled.useMutation({
    onSuccess: (data) => {
      toast.success(t("page.bulkMarkedBilled", { count: data.count }));
      setSelectedEntries(new Set());
      setShowBulkActions(false);
      refetchEntries();
    },
    onError: (error, variables) => {
      toastError(error, t("page.bulkUpdateFailed"), () => {
        bulkMarkBilledMutation.mutate(variables);
      });
    },
  });
  const bulkMoveToProjectMutation = trpc.time.bulkMoveToProject.useMutation({
    onSuccess: (data) => {
      toast.success(
        t("page.bulkMoved", {
          count: data.count,
          project: data.projectName ?? "",
        }),
      );
      setSelectedEntries(new Set());
      setShowBulkActions(false);
      setShowMoveToProject(false);
      refetchEntries();
    },
    onError: (error, variables) => {
      toastError(error, t("page.bulkMoveFailed"), () => {
        bulkMoveToProjectMutation.mutate(variables);
      });
    },
  });
  const bulkRecalculateRatesMutation =
    trpc.time.bulkRecalculateRates.useMutation({
      onSuccess: (data) => {
        toast.success(
          data.skippedReason
            ? t("page.bulkRecalculatedSkipped", {
                count: data.updated,
                skipped: data.skipped,
                reason: data.skippedReason,
              })
            : t("page.bulkRecalculated", { count: data.updated }),
        );
        setSelectedEntries(new Set());
        setShowBulkActions(false);
        refetchEntries();
      },
      onError: (error, variables) => {
        toastError(error, t("page.recalculateFailed"), () => {
          bulkRecalculateRatesMutation.mutate(variables);
        });
      },
    });
  const toggleBillableMutation = trpc.time.toggleBillable.useMutation({
    onSuccess: () => {
      refetchEntries();
    },
    onError: (error) => {
      toastError(error, t("page.billableToggleFailed"));
    },
  });

  const handleResumeEntry = (entry: {
    id: string;
    hours: string;
    projectId?: string | null;
    clientId?: string | null;
    description: string | null;
  }) => {
    const hours = parseFloat(entry.hours || "0");
    continueEntry({
      entryId: entry.id,
      projectId: entry.projectId || undefined,
      clientId: entry.clientId || undefined,
      description: entry.description || "",
      hours,
    });
    toast.success(
      t("page.resumed", {
        hours: hours.toLocaleString(toIntlLocale(locale), {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      }),
    );
  };

  const totalHoursDecimal =
    timeEntries?.reduce(
      (sum, entry) => sum + parseFloat(entry.hours || "0"),
      0,
    ) || 0;
  const billableHoursDecimal =
    timeEntries?.reduce(
      (sum, entry) =>
        entry.isBillable === false ? sum : sum + parseFloat(entry.hours || "0"),
      0,
    ) || 0;
  const unbilledHoursDecimal =
    timeEntries?.reduce(
      (sum, entry) =>
        entry.isBillable === false || entry.isBilled
          ? sum
          : sum + parseFloat(entry.hours || "0"),
      0,
    ) || 0;

  if (timeEntriesError) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">
          {t("page.loadError")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-tour="time-entries-list">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        helpTopicId="time-tracking"
        actions={
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Button
              variant="outline"
              onClick={() => setShowImportModal(true)}
              leftIcon={<FileSpreadsheet className="h-4 w-4 sm:h-5 sm:w-5" />}
            >
              <span className="xs:hidden">{t("page.importShort")}</span>
              <span className="hidden xs:inline">{t("page.importLong")}</span>
            </Button>
            <div
              className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
              data-tour="time-view-toggle"
            >
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`p-2 transition-colors ${viewMode === "list" ? "bg-tt-gran text-tt-paa-gran" : "bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                title={t("page.listView")}
                aria-label={t("page.listView")}
                aria-pressed={viewMode === "list"}
              >
                <List className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("timesheet")}
                className={`p-2 transition-colors ${viewMode === "timesheet" ? "bg-tt-gran text-tt-paa-gran" : "bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                title={t("page.weekView")}
                aria-label={t("page.weekView")}
                aria-pressed={viewMode === "timesheet"}
              >
                <Grid3x3 className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() =>
                setTemplateEntry({
                  description: "",
                  projectId: null,
                  clientId: null,
                  hours: "0",
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              title={t("page.newTemplate")}
              aria-label={t("page.newTemplate")}
            >
              <Bookmark className="h-4 w-4" />
              <span className="hidden sm:inline">{t("page.newTemplate")}</span>
            </button>
            <Link
              href="/dashboard/time/new"
              title={t("page.shortcut")}
              aria-keyshortcuts="n"
            >
              <Button leftIcon={<Plus className="h-4 w-4 sm:h-5 sm:w-5" />}>
                {t("page.newEntry")}
              </Button>
            </Link>
          </div>
        }
      />

      {/* Active session — only show timer widget when running or paused with time */}
      {(isRunning || elapsedTime > 0) && (
        <TimerWidget
          projects={projects}
          clients={clients}
          onTimeEntrySaved={refetchEntries}
        />
      )}

      {/* Collapsible tools panel */}
      <div>
        <button
          type="button"
          onClick={() => setShowTools(!showTools)}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <Wrench className="h-4 w-4" />
          {t("page.tools")}
          {showTools ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        {showTools && (
          <div className="mt-2 space-y-4">
            {/* AI Time Suggestions */}
            <AITimeSuggestions />

            {/* Timer Widget — show here when not in active session above */}
            {!isRunning && elapsedTime === 0 && (
              <TimerWidget
                projects={projects}
                clients={clients}
                onTimeEntrySaved={refetchEntries}
              />
            )}

            {/* Pomodoro Timer */}
            <div className="lg:max-w-sm">
              <PomodoroTimer />
            </div>

            {/* Timeline View - only show for single day view */}
            {startDate === endDate && timeEntries && timeEntries.length > 0 && (
              <TimelineView
                entries={timeEntries}
                date={new Date(startDate)}
                onEntryClick={(entry) => setEditingEntryId(entry.id)}
              />
            )}

            {/* Productivity Insights */}
            <ProductivityInsights />
          </div>
        )}
      </div>

      {/* Weekly Timesheet View */}
      {viewMode === "timesheet" && (
        <WeeklyTimesheetView onEntryClick={(id) => setEditingEntryId(id)} />
      )}

      {/* List View: Date selector and filters */}
      {viewMode === "list" && (
        <>
          {/* Stats strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200 dark:bg-gray-800 rounded-xl overflow-hidden">
            <div className="bg-white dark:bg-gray-900 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("page.statTotal")}
              </div>
              <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white mt-1">
                {formatHoursToTime(totalHoursDecimal.toString())}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-900 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("page.statBillable")}
              </div>
              <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white mt-1">
                {formatHoursToTime(billableHoursDecimal.toString())}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-900 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("page.statUnbilled")}
              </div>
              <div
                className={`text-2xl font-bold tabular-nums mt-1 ${
                  unbilledHoursDecimal > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-gray-900 dark:text-white"
                }`}
              >
                {formatHoursToTime(unbilledHoursDecimal.toString())}
              </div>
            </div>
            <div className="bg-white dark:bg-gray-900 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("page.statEntries")}
              </div>
              <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white mt-1">
                {timeEntries?.length || 0}
                {hasMore && "+"}
              </div>
            </div>
          </div>

          {/* Date selector and filters */}
          <div className="space-y-2">
            <div>
              {/* Quick date range filters */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <Calendar className="h-5 w-5 text-gray-400 shrink-0" />
                {(
                  [
                    { key: "today" },
                    { key: "yesterday" },
                    { key: "thisWeek" },
                    { key: "lastWeek" },
                    { key: "thisMonth" },
                    { key: "lastMonth" },
                    "separator",
                    { key: "thisQuarter" },
                    { key: "lastQuarter" },
                    { key: "thisYear" },
                    { key: "lastYear" },
                  ] as const
                ).map((item) =>
                  item === "separator" ? (
                    <div
                      key="sep"
                      className="h-5 w-px bg-gray-300 dark:bg-gray-600 mx-0.5"
                    />
                  ) : (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() =>
                        handleDateRangePresetChange(item.key as DateRangePreset)
                      }
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        dateRangePreset === item.key
                          ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      {t(`page.preset.${item.key}`)}
                    </button>
                  ),
                )}
              </div>

              {/* Custom date range & filters row */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Custom date range inputs */}
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) =>
                        handleCustomDateChange("start", e.target.value)
                      }
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        dateRangePreset === "custom"
                          ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                      } text-gray-900 dark:text-white`}
                    />
                    <span className="text-gray-400">→</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) =>
                        handleCustomDateChange("end", e.target.value)
                      }
                      min={startDate}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        dateRangePreset === "custom"
                          ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                      } text-gray-900 dark:text-white`}
                    />
                  </div>

                  {/* Filters button */}
                  <button
                    type="button"
                    onClick={() => setShowFilters(!showFilters)}
                    className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      showFilters ||
                      filterProjectId ||
                      filterClientId ||
                      filterBilledStatus ||
                      filterBillableStatus
                        ? "bg-brand-100 dark:bg-tt-gran-lys text-brand-700 dark:text-brand-300"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}
                  >
                    <Filter className="h-4 w-4" />
                    {t("page.filters")}
                    {(filterProjectId ||
                      filterClientId ||
                      filterBilledStatus ||
                      filterBillableStatus) && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-tt-gran text-xs text-tt-paa-gran">
                        {
                          [
                            filterProjectId,
                            filterClientId,
                            filterBilledStatus,
                            filterBillableStatus,
                          ].filter(Boolean).length
                        }
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Filter panel */}
            {showFilters && (
              <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-3 sm:gap-4">
                  {/* Project filter */}
                  <div className="w-full sm:w-auto sm:min-w-48 sm:flex-1">
                    <label
                      htmlFor="time-filter-project"
                      className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
                    >
                      {t("page.filterProject")}
                    </label>
                    <ProjectSelect
                      id="time-filter-project"
                      projects={projects}
                      value={filterProjectId || null}
                      onChange={(v) => setFilterProjectId(v ?? "")}
                      placeholder={t("page.allProjects")}
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                    />
                  </div>

                  {/* Client filter */}
                  <div className="w-full sm:w-auto sm:min-w-48 sm:flex-1">
                    <label
                      htmlFor="time-filter-client"
                      className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
                    >
                      {t("page.filterClient")}
                    </label>
                    <ClientSearchCombobox
                      id="time-filter-client"
                      clients={clients}
                      value={filterClientId}
                      onChange={setFilterClientId}
                      placeholder={t("page.allClients")}
                      allowClear
                      clearLabel={t("page.allClients")}
                    />
                  </div>

                  {/* Billed status filter */}
                  <div className="w-full sm:w-auto sm:min-w-36">
                    <label
                      htmlFor="time-filter-billed"
                      className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
                    >
                      {t("page.filterBilled")}
                    </label>
                    <select
                      id="time-filter-billed"
                      value={filterBilledStatus}
                      onChange={(e) =>
                        setFilterBilledStatus(
                          e.target.value as "" | "billed" | "unbilled",
                        )
                      }
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                    >
                      <option value="">{t("page.optionAll")}</option>
                      <option value="billed">{t("page.optionBilled")}</option>
                      <option value="unbilled">
                        {t("page.optionUnbilled")}
                      </option>
                    </select>
                  </div>

                  {/* Billable status filter */}
                  <div className="w-full sm:w-auto sm:min-w-36">
                    <label
                      htmlFor="time-filter-billable"
                      className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
                    >
                      {t("page.filterBillable")}
                    </label>
                    <select
                      id="time-filter-billable"
                      value={filterBillableStatus}
                      onChange={(e) =>
                        setFilterBillableStatus(
                          e.target.value as "" | "billable" | "non-billable",
                        )
                      }
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                    >
                      <option value="">{t("page.optionAll")}</option>
                      <option value="billable">
                        {t("page.optionBillable")}
                      </option>
                      <option value="non-billable">
                        {t("page.optionNonBillable")}
                      </option>
                    </select>
                  </div>

                  {/* Team-scope: vis kun egne (standard) eller hele teamet */}
                  {orgMembers && orgMembers.length > 1 && (
                    <div className="w-full sm:w-auto">
                      <span className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                        {t("page.view")}
                      </span>
                      <div className="inline-flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
                        <button
                          type="button"
                          onClick={() => setShowTeamTime(false)}
                          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                            !showTeamTime
                              ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                          }`}
                        >
                          {t("page.onlyMine")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowTeamTime(true)}
                          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                            showTeamTime
                              ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                          }`}
                        >
                          {t("page.wholeTeam")}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Medarbejder-filter — kun relevant når hele teamet vises */}
                  {orgMembers && orgMembers.length > 1 && showTeamTime && (
                    <div className="w-full sm:w-auto sm:min-w-48 sm:flex-1">
                      <label
                        htmlFor="time-filter-member"
                        className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400"
                      >
                        {t("page.member")}
                      </label>
                      <select
                        id="time-filter-member"
                        value={filterMemberId}
                        onChange={(e) => setFilterMemberId(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                      >
                        <option value="">{t("page.allMembers")}</option>
                        {orgMembers.map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Clear filters button */}
                  {(filterProjectId ||
                    filterClientId ||
                    filterBilledStatus ||
                    filterBillableStatus ||
                    filterMemberId ||
                    showTeamTime) && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilterProjectId("");
                        setFilterClientId("");
                        setFilterBilledStatus("");
                        setFilterBillableStatus("");
                        setFilterMemberId("");
                        setShowTeamTime(false);
                      }}
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      <X className="h-4 w-4" />
                      {t("page.clearFilters")}
                    </button>
                  )}

                  {/* Save filters as default */}
                  {(filterProjectId ||
                    filterClientId ||
                    filterBilledStatus ||
                    filterBillableStatus ||
                    savedDefaultFilters) && (
                    <button
                      type="button"
                      onClick={() => {
                        const hasAny =
                          filterProjectId ||
                          filterClientId ||
                          filterBilledStatus ||
                          filterBillableStatus;
                        if (!hasAny) {
                          setSavedDefaultFilters(null);
                          toast.success(t("page.defaultsCleared"));
                          return;
                        }
                        setSavedDefaultFilters({
                          projectId: filterProjectId,
                          clientId: filterClientId,
                          billedStatus: filterBilledStatus,
                          billableStatus: filterBillableStatus,
                        });
                        toast.success(t("page.defaultsSaved"));
                      }}
                      title={
                        filterProjectId ||
                        filterClientId ||
                        filterBilledStatus ||
                        filterBillableStatus
                          ? t("page.saveDefaultTitle")
                          : t("page.clearDefaultTitle")
                      }
                      className="inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      <Bookmark className="h-4 w-4" />
                      {filterProjectId ||
                      filterClientId ||
                      filterBilledStatus ||
                      filterBillableStatus
                        ? t("page.saveDefault")
                        : t("page.clearDefault")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Time entries */}
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {timeEntries && timeEntries.length > 0 && (
                  <input
                    type="checkbox"
                    checked={
                      selectedEntries.size === timeEntries.length &&
                      timeEntries.length > 0
                    }
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedEntries(
                          new Set(timeEntries.map((entry) => entry.id)),
                        );
                      } else {
                        setSelectedEntries(new Set());
                      }
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                  />
                )}
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {t("page.entriesTitle")}
                  {selectedEntries.size > 0 && (
                    <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-400">
                      {t("page.selectedCount", { count: selectedEntries.size })}
                    </span>
                  )}
                </h2>
                <select
                  value={groupBy}
                  onChange={(e) =>
                    setGroupBy(e.target.value as TimeListGroupBy)
                  }
                  className="ml-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                  aria-label={t("page.groupAria")}
                >
                  <option value="date">{t("page.groupByDate")}</option>
                  <option value="client">{t("page.groupByClient")}</option>
                  <option value="project">{t("page.groupByProject")}</option>
                  <option value="tag">{t("page.groupByTag")}</option>
                  <option value="task">{t("page.groupByTask")}</option>
                  <option value="none">{t("page.groupNone")}</option>
                </select>
              </div>

              {/* Bulk Actions Dropdown */}
              {selectedEntries.size > 0 && (
                <div className="relative">
                  <Button
                    onClick={() => setShowBulkActions(!showBulkActions)}
                    rightIcon={<ChevronDown className="h-4 w-4" />}
                  >
                    {t("page.actions", { count: selectedEntries.size })}
                  </Button>

                  {showBulkActions && (
                    <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg">
                      <div className="py-1">
                        {/* Mark as Billed */}
                        <button
                          type="button"
                          disabled={bulkMarkBilledMutation.isPending}
                          onClick={() => {
                            bulkMarkBilledMutation.mutate({
                              ids: Array.from(selectedEntries),
                              isBilled: true,
                            });
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          {t("page.markBilled")}
                        </button>

                        {/* Mark as Unbilled */}
                        <button
                          type="button"
                          disabled={bulkMarkBilledMutation.isPending}
                          onClick={() => {
                            bulkMarkBilledMutation.mutate({
                              ids: Array.from(selectedEntries),
                              isBilled: false,
                            });
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          <X className="h-4 w-4 text-orange-600" />
                          {t("page.markUnbilled")}
                        </button>

                        {/* Move to Project */}
                        <button
                          type="button"
                          onClick={() => setShowMoveToProject(true)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          <FolderKanban className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                          {t("page.moveToProject")}
                        </button>

                        {/* Træk de valgte poster på et klippekort */}
                        <button
                          type="button"
                          onClick={() => {
                            setShowBulkActions(false);
                            setShowAssignPrepaid(true);
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          <Ticket className="h-4 w-4 text-purple-600" />
                          {t("page.drawFromPrepaid")}
                        </button>

                        {/* Recalculate rates */}
                        <button
                          type="button"
                          disabled={bulkRecalculateRatesMutation.isPending}
                          onClick={() => {
                            bulkRecalculateRatesMutation.mutate({
                              ids: Array.from(selectedEntries),
                            });
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          <Wrench className="h-4 w-4 text-purple-600" />
                          {t("page.recalcRates")}
                        </button>

                        <div className="border-t border-gray-100 dark:border-gray-800 my-1" />

                        {/* Delete */}
                        <button
                          type="button"
                          onClick={() => setShowBulkDeleteConfirm(true)}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <Trash2 className="h-4 w-4" />
                          {t("page.deleteSelected", {
                            count: selectedEntries.size,
                          })}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Move to Project Modal */}
                  {showMoveToProject && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                      <div className="w-full max-w-md rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xl">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                          {t("page.moveTitle")}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                          {t("page.moveDescription", {
                            count: selectedEntries.size,
                          })}
                        </p>
                        <ProjectSelect
                          projects={projects}
                          value={null}
                          onChange={(v) => {
                            if (v) {
                              bulkMoveToProjectMutation.mutate({
                                ids: Array.from(selectedEntries),
                                projectId: v,
                              });
                            }
                          }}
                          placeholder={t("page.selectProject")}
                          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-900 dark:text-white mb-4"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowMoveToProject(false)}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                          >
                            {tc("cancel")}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800/50">
              {timeEntriesLoading ? (
                // Første load: skeleton i stedet for "Ingen tidsposteringer"
                <div className="space-y-3 p-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800"
                    />
                  ))}
                </div>
              ) : timeEntries && timeEntries.length > 0 ? (
                (() => {
                  const isMultiDay = startDate !== endDate;
                  // When date-grouping on a single-day view, collapse header
                  const effectiveGroupBy: TimeListGroupBy =
                    groupBy === "date" && !isMultiDay ? "none" : groupBy;
                  const showHeader = effectiveGroupBy !== "none";
                  const groups = groupEntries(
                    timeEntries,
                    effectiveGroupBy,
                    groupLabels,
                  );

                  return groups.map((group) => (
                    <div key={group.groupKey}>
                      {showHeader && (
                        <div
                          className="sticky top-0 z-10 flex items-center justify-between bg-gray-50/90 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 px-4 py-2"
                          style={
                            group.groupColor
                              ? { borderLeft: `4px solid ${group.groupColor}` }
                              : undefined
                          }
                        >
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {group.groupLabel}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium tabular-nums text-gray-500 dark:text-gray-400">
                              {formatHoursToTime(group.totalHours.toString())}
                              <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                                {t("page.entryCount", {
                                  count: group.entryCount,
                                })}
                              </span>
                            </span>
                            {effectiveGroupBy === "task" &&
                              group.groupKey !== "none" && (
                                <button
                                  type="button"
                                  title={t("page.newOnTask")}
                                  onClick={() => {
                                    const firstEntry = group.entries[0];
                                    startTimer({
                                      description:
                                        firstEntry?.description ||
                                        group.groupLabel,
                                      projectId: firstEntry?.project?.id,
                                      clientId: firstEntry?.client?.id,
                                      taskId: group.groupKey,
                                    });
                                    toast.success(
                                      t("page.timerStartedForTask"),
                                    );
                                  }}
                                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-brand-600 dark:hover:text-brand-300 dark:hover:bg-gray-700"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                </button>
                              )}
                          </div>
                        </div>
                      )}
                      {group.entries.map((entry) => (
                        <div
                          key={entry.id}
                          className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors ${
                            entry.isBilled
                              ? "bg-green-50/50 dark:bg-green-900/10"
                              : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedEntries.has(entry.id)}
                            onChange={(e) => {
                              const newSelected = new Set(selectedEntries);
                              if (e.target.checked) {
                                newSelected.add(entry.id);
                              } else {
                                newSelected.delete(entry.id);
                              }
                              setSelectedEntries(newSelected);
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                          />
                          {/* min-w lader handlingerne ombryde til egen linje
                              på mobil i stedet for at klemme teksten */}
                          <div className="min-w-[12rem] flex-1">
                            <InlineDescriptionEdit
                              entryId={entry.id}
                              initialDescription={entry.description || ""}
                              onSuccess={refetchEntries}
                            />
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {entry.project
                                ? t("page.clientProject", {
                                    client:
                                      entry.project.client?.name ??
                                      t("group.noClient"),
                                    project: entry.project.name,
                                  })
                                : entry.client?.name || t("group.noClient")}
                            </p>
                            {entry.user &&
                              orgMembers &&
                              orgMembers.length > 1 && (
                                <p className="text-xs text-gray-400 dark:text-gray-500">
                                  {t("page.byUser", { name: entry.user.name })}
                                </p>
                              )}
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                              {/* Only show date per entry in single-day view */}
                              {!isMultiDay && (
                                <span className="text-xs text-gray-500 dark:text-gray-500">
                                  {new Date(entry.date).toLocaleDateString(
                                    toIntlLocale(locale),
                                  )}
                                </span>
                              )}
                              {/* Time range display - when work actually happened */}
                              {entry.startTime && entry.endTime && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-tt-gran-lys px-2 py-0.5 text-xs text-brand-700 dark:text-brand-300">
                                  <Clock className="h-3 w-3" />
                                  {new Date(entry.startTime).toLocaleTimeString(
                                    toIntlLocale(locale),
                                    {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    },
                                  )}
                                  {" - "}
                                  {new Date(entry.endTime).toLocaleTimeString(
                                    toIntlLocale(locale),
                                    {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    },
                                  )}
                                </span>
                              )}
                              {entry.isBilled && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
                                  <Check className="h-3 w-3" />
                                  {t("page.statusBilled")}
                                </span>
                              )}
                              {entry.isBillable === false && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">
                                  <DollarSign className="h-3 w-3" />
                                  {t("page.statusNonBillable")}
                                </span>
                              )}
                              {entry.approvalStatus &&
                                entry.approvalStatus !== "not_required" && (
                                  <span
                                    className={`ml-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                      entry.approvalStatus === "approved"
                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                        : entry.approvalStatus === "rejected"
                                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                    }`}
                                    title={
                                      entry.approvalStatus === "rejected" &&
                                      entry.rejectionReason
                                        ? entry.rejectionReason
                                        : undefined
                                    }
                                  >
                                    {entry.approvalStatus === "approved" &&
                                      t("page.approvalApproved")}
                                    {entry.approvalStatus === "pending" &&
                                      t("page.approvalPending")}
                                    {entry.approvalStatus === "rejected" &&
                                      t("page.approvalRejected")}
                                  </span>
                                )}
                            </div>
                          </div>
                          <div className="ml-auto flex items-center gap-4">
                            <div className="text-right">
                              <InlineHoursEdit
                                entryId={entry.id}
                                initialHours={entry.hours || "0"}
                                projectId={entry.projectId}
                                clientId={entry.clientId}
                                onSuccess={refetchEntries}
                              />
                              {entry.isPrepaid && (
                                <div className="mt-0.5 flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400">
                                  <Ticket className="h-3 w-3" />
                                  {entry.prepaidPackage?.name ??
                                    t("page.prepaidFallback")}
                                </div>
                              )}
                            </div>
                            {/* Billable toggle button */}
                            <button
                              type="button"
                              onClick={() =>
                                toggleBillableMutation.mutate({
                                  id: entry.id,
                                  isBillable: !entry.isBillable,
                                })
                              }
                              disabled={toggleBillableMutation.isPending}
                              className={`p-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ${
                                entry.isBillable
                                  ? "text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
                                  : "text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                              } disabled:opacity-50`}
                              title={
                                entry.isBillable
                                  ? t("page.markNonBillable")
                                  : t("page.markBillable")
                              }
                            >
                              <DollarSign className="h-4 w-4" />
                            </button>
                            <div className="flex items-center gap-2">
                              {/* Fakturerede poster er låst (#702) og kan ikke fortsættes */}
                              {!entry.isBilled && (
                                <button
                                  type="button"
                                  title={t("page.continueSession")}
                                  data-testid="entry-continue"
                                  onClick={() => {
                                    const { resumeAsSegment } =
                                      useTimerStore.getState();
                                    resumeAsSegment({
                                      entryId: entry.id,
                                      projectId: entry.project?.id,
                                      clientId: entry.client?.id,
                                      description: entry.description || "",
                                      taskId:
                                        entry.task?.id ??
                                        entry.taskId ??
                                        undefined,
                                    });
                                    toast.success(t("page.continueStarted"));
                                  }}
                                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-green-600 dark:hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
                                >
                                  <Play className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setTemplateEntry({
                                    description: entry.description || "",
                                    projectId: entry.projectId || null,
                                    clientId:
                                      entry.clientId ||
                                      entry.project?.client?.id ||
                                      null,
                                    hours: entry.hours || "0",
                                  })
                                }
                                className="rounded p-0.5 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
                                title={t("page.saveAsTemplate")}
                              >
                                <Bookmark className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  duplicateMutation.mutate({ id: entry.id })
                                }
                                disabled={duplicateMutation.isPending}
                                className="rounded p-0.5 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
                                title={t("page.duplicateToday")}
                              >
                                <Copy className="h-4 w-4" />
                              </button>
                              {calendarStatus?.connected && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    exportToCalendarMutation.mutate({
                                      timeEntryId: entry.id,
                                    })
                                  }
                                  disabled={exportToCalendarMutation.isPending}
                                  className="rounded p-0.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
                                  title={t("page.exportCalendar")}
                                  aria-label={t("page.exportCalendar")}
                                >
                                  <CalendarPlus className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setEditingEntryId(entry.id)}
                                className="rounded p-0.5 text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
                                title={tc("edit")}
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmEntry(entry.id)}
                                className="rounded p-0.5 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
                                title={tc("delete")}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                              {/* Prominent resume — far right, larger, so it's
                                  easy to re-track a past activity */}
                              {/* Fakturerede poster er låst (#702) og kan ikke genoptages */}
                              {!entry.isBilled && (
                                <button
                                  type="button"
                                  onClick={() => handleResumeEntry(entry)}
                                  className="ml-1.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-600 text-white shadow-sm transition-colors hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-1"
                                  title={t("page.resumeEntry")}
                                >
                                  <Play className="h-5 w-5 fill-current" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ));
                })()
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Clock className="h-8 w-8 text-gray-300 dark:text-gray-600" />
                  <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
                    {startDate === endDate
                      ? t("page.emptyForDate", {
                          date: new Date(startDate).toLocaleDateString(
                            toIntlLocale(locale),
                          ),
                        })
                      : t("page.emptyForRange", {
                          from: new Date(startDate).toLocaleDateString(
                            toIntlLocale(locale),
                          ),
                          to: new Date(endDate).toLocaleDateString(
                            toIntlLocale(locale),
                          ),
                        })}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t("page.emptyHint")}
                  </p>
                  <Link
                    href="/dashboard/time/new"
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    {t("page.logTime")}
                  </Link>
                </div>
              )}
            </div>

            {/* Load More Button */}
            {hasMore && (
              <div className="border-t border-gray-200 dark:border-gray-800 p-4">
                <Button
                  variant="outline"
                  fullWidth
                  onClick={loadMore}
                  isLoading={isFetching}
                  disabled={isFetching}
                >
                  {t("page.loadMore")}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Edit Modal */}
      {editingEntryId && (
        <TimeEntryEditModal
          entryId={editingEntryId}
          isOpen={!!editingEntryId}
          onClose={() => setEditingEntryId(null)}
          onSuccess={() => refetchEntries()}
        />
      )}

      {/* CSV Import Modal */}
      <CSVImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onSuccess={() => {
          refetchEntries();
          toast.success(t("page.imported"));
        }}
      />

      {/* Single Entry Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteConfirmEntry}
        onClose={() => setDeleteConfirmEntry(null)}
        onConfirm={() => {
          if (deleteConfirmEntry) {
            const entry = timeEntries.find((e) => e.id === deleteConfirmEntry);
            const payload = entry ? buildRestorePayload(entry) : null;
            deleteMutation.mutate(
              { id: deleteConfirmEntry },
              {
                onSuccess: () => {
                  if (payload) {
                    toast(t("page.deletedToast"), {
                      duration: 8000,
                      action: {
                        label: t("page.undo"),
                        onClick: () => restoreMutation.mutate(payload),
                      },
                    });
                  }
                },
              },
            );
            setDeleteConfirmEntry(null);
          }
        }}
        title={t("page.deleteTitle")}
        description={t("page.deleteDescription")}
        confirmLabel={tc("delete")}
        variant="danger"
        isLoading={deleteMutation.isPending}
      />

      {/* Bulk Delete Confirmation */}
      <ConfirmDialog
        isOpen={showBulkDeleteConfirm}
        onClose={() => setShowBulkDeleteConfirm(false)}
        onConfirm={() => {
          bulkDeleteMutation.mutate({
            ids: Array.from(selectedEntries),
          });
          setShowBulkDeleteConfirm(false);
        }}
        title={t("page.bulkDeleteTitle")}
        description={t("page.bulkDeleteDescription", {
          count: selectedEntries.size,
        })}
        confirmLabel={t("page.deleteSelected", { count: selectedEntries.size })}
        variant="danger"
        isLoading={bulkDeleteMutation.isPending}
      />

      {/* Bulk: træk de markerede posteringer på et klippekort */}
      <BulkAssignPrepaidModal
        isOpen={showAssignPrepaid}
        onClose={() => setShowAssignPrepaid(false)}
        timeEntryIds={Array.from(selectedEntries)}
        onAssigned={() => {
          setSelectedEntries(new Set());
          refetchEntries();
        }}
      />

      {/* Save as Template Modal */}
      <SaveAsTemplateModal
        isOpen={!!templateEntry}
        onClose={() => setTemplateEntry(null)}
        defaultTemplateType="time_entry"
        defaultDescription={templateEntry?.description || ""}
        defaultProjectId={templateEntry?.projectId}
        defaultClientId={templateEntry?.clientId}
        defaultHours={templateEntry?.hours}
      />

      {/* Click outside to close bulk actions */}
      {showBulkActions && (
        <button
          type="button"
          className="fixed inset-0 z-0"
          onClick={() => setShowBulkActions(false)}
          aria-label={t("closeMenu")}
        />
      )}
    </div>
  );
}
