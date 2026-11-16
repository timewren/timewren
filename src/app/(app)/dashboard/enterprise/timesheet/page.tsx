"use client";

import {
  AlertTriangle,
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  Lock,
  MessageSquare,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Save,
  Send,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Fragment,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { useActiveOrganization, useSession } from "@/lib/auth-client";
import {
  EMPTY_ROW_STATE,
  groupTimesheetRows,
  type TimesheetRowState,
  timesheetRowKey,
  timesheetRowStateKey,
} from "@/lib/enterprise/activity-types";
import {
  formatHours,
  formatTotal,
  nextFocusCell,
  parseHours,
} from "@/lib/enterprise/timesheet";
import { TIMESHEET_NOTE_MAX_LENGTH } from "@/lib/enterprise/timesheet-validation";
import {
  addDays,
  isoWeekNumber,
  parseISOWeekString,
  startOfISOWeek,
  toDateStr,
  toISOWeekString,
} from "@/lib/enterprise/week";
import { localizeDayOffName } from "@/lib/holidays/names";
import { escapeCsv } from "@/lib/utils/spreadsheet";
import { trpc } from "@/providers/trpc-provider";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

type RowSource = "entries" | "assigned" | "all" | "manual";

type DayCell = { total: number; timesheetHours: number; note: string | null };

/** Én grid-række: (projekt, aktivitet). activityTypeId null = uden aktivitet. */
type GridRow = {
  projectId: string | null;
  projectName: string;
  activityTypeId: string | null;
  activityName: string | null;
  activityColor: string | null;
  source: RowSource;
  hidden: boolean;
  days: Record<string, DayCell>;
};

/** Nøgle for celle-redigeringer: (projekt, aktivitet, dag). */
function localizeMaybe(name: string | undefined): string | undefined {
  return name === undefined ? undefined : localizeDayOffName(name);
}

function cellEditKey(
  projectId: string,
  activityTypeId: string | null,
  date: string,
): string {
  return `${projectId}|${activityTypeId ?? ""}:${date}`;
}

/**
 * Ekspand-/rækketilstand pr. projekt huskes i browseren pr. org+bruger (#475):
 * åbne/lukkede grupper og aktivitetsrækker brugeren selv har tilføjet.
 */
function loadRowState(key: string): TimesheetRowState {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return EMPTY_ROW_STATE;
    const obj = parsed as Partial<TimesheetRowState>;
    const toggles: TimesheetRowState["toggles"] = {};
    for (const [id, v] of Object.entries(obj.toggles ?? {})) {
      if (v === "open" || v === "closed") toggles[id] = v;
    }
    return {
      toggles,
      added: Array.isArray(obj.added)
        ? obj.added.filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return EMPTY_ROW_STATE;
  }
}

function saveRowState(key: string, state: TimesheetRowState): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // localStorage utilgængelig (privat vindue) — tilstanden er blot flygtig
  }
}

/** "+ Tilføj aktivitet"-vælger: tilføjer en tom aktivitetsrække lokalt. */
function AddActivitySelect({
  options,
  onAdd,
  compact,
}: {
  options: Array<{ id: string; name: string }>;
  onAdd: (activityTypeId: string) => void;
  compact?: boolean;
}) {
  const tx = useTranslations("enterpriseTimesheet");
  return (
    <select
      value=""
      aria-label={tx("addActivity")}
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value);
      }}
      className={`rounded-md border border-dashed border-gray-300 bg-transparent text-gray-500 hover:border-gray-400 hover:text-gray-800 focus:border-brand-500 focus:outline-none dark:border-gray-600 dark:text-gray-400 dark:hover:text-gray-200 ${
        compact ? "px-1.5 py-0.5 text-xs" : "px-2 py-1 text-xs"
      }`}
    >
      <option value="">{tx("addActivityOption")}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

const HOUR_INPUT_CLASS =
  "w-16 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-gray-900 shadow-sm placeholder:text-gray-300 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-600 dark:hover:border-gray-600 dark:disabled:bg-gray-900";

/**
 * Piletaster/Enter mellem timeceller i ugetabellen (#427). Positionen findes
 * i DOM'en: rækken = cellens plads blandt cellerne for samme dag i tabellen,
 * kolonnen = pladsen blandt cellerne i samme række. Så virker navigationen på
 * tværs af grupper og aktivitetsrækker uden at spore indeks. Uden for tabellen
 * (mobilvisningen) returneres false, og Enter blurrer som før.
 */
function moveHourCellFocus(input: HTMLInputElement, key: string): boolean {
  const scope = input.closest("table");
  const rowEl = input.closest("tr");
  const day = input.dataset.tsDay;
  if (!scope || !rowEl || !day) return false;
  const enabled = (els: NodeListOf<HTMLInputElement>) =>
    Array.from(els).filter((el) => !el.disabled);
  const column = enabled(
    scope.querySelectorAll<HTMLInputElement>(`input[data-ts-day="${day}"]`),
  );
  const row = enabled(
    rowEl.querySelectorAll<HTMLInputElement>("input[data-ts-day]"),
  );
  const pos = { row: column.indexOf(input), col: row.indexOf(input) };
  if (pos.row < 0 || pos.col < 0) return false;
  const caretStart = input.selectionStart ?? 0;
  const caretEnd = input.selectionEnd ?? 0;
  const next = nextFocusCell(
    pos,
    key,
    { rowCount: column.length, colCount: row.length },
    caretStart === 0 && caretEnd === 0,
    caretStart === input.value.length && caretEnd === input.value.length,
  );
  if (!next) return false;
  const target = next.row !== pos.row ? column[next.row] : row[next.col];
  if (!target) return false;
  target.focus();
  target.select();
  return true;
}

/** Redigerbar timecelle — delt af flade projektrækker og aktivitetsrækker. */
function HourCell({
  value,
  day,
  disabled,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  day: string;
  disabled: boolean;
  onChange: (raw: string) => void;
  onCommit: (raw: string) => void;
  onCancel: () => void;
}) {
  const tx = useTranslations("enterpriseTimesheet");
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value}
      placeholder="–"
      disabled={disabled}
      data-ts-day={day}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onCancel();
          e.currentTarget.blur();
          return;
        }
        if (
          e.key === "Enter" ||
          e.key === "ArrowDown" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight"
        ) {
          // Fokusskift blurrer cellen og gemmer den via onBlur.
          if (moveHourCellFocus(e.currentTarget, e.key)) {
            e.preventDefault();
          } else if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }
      }}
      title={tx("hourHint")}
      className={HOUR_INPUT_CLASS}
    />
  );
}

/** Note-ikon i cellen (#467): udfyldt når der er en note; klik åbner editor. */
function NoteButton({
  note,
  hasHours,
  disabled,
  onClick,
}: {
  note: string | null;
  hasHours: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const tx = useTranslations("enterpriseTimesheet");
  const Icon = note ? MessageSquareText : MessageSquare;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || (!hasHours && !note)}
      aria-label={note ? tx("editNote", { note }) : tx("addNoteToDay")}
      title={note ?? (hasHours ? tx("addNote") : tx("enterHoursFirst"))}
      className={`rounded p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        note
          ? "text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-tt-gran-lys"
          : "text-gray-300 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

/** Lille "⋯"-menu på en tom række: skjul fast række / fjern manuel række. */
function RowMenu({
  source,
  onHide,
  onRemove,
  disabled,
}: {
  source: RowSource;
  onHide: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const tx = useTranslations("enterpriseTimesheet");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label={tx("rowOptions")}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 text-gray-400 opacity-100 transition-opacity hover:bg-gray-100 hover:text-gray-700 focus:opacity-100 disabled:opacity-40 sm:opacity-40 sm:group-hover:opacity-100 sm:hover:opacity-100 sm:focus:opacity-100 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              if (source === "manual") onRemove();
              else onHide();
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <EyeOff className="h-4 w-4 text-gray-400" />
            {source === "manual" ? tx("removeRow") : tx("hideRow")}
          </button>
        </div>
      )}
    </div>
  );
}

function TimesheetPageContent() {
  const tx = useTranslations("enterpriseTimesheet");
  const tc = useTranslations("enterpriseCommon");
  const tDays = useTranslations("team.days");
  const locale = useLocale();
  const intl = toIntlLocale(locale);
  const fmtDayLabel = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return `${tDays(DAY_KEYS[(dt.getDay() + 6) % 7])} ${d}/${m}`;
  };
  const router = useRouter();
  const searchParams = useSearchParams();
  const [weekStart, setWeekStartState] = useState(
    () =>
      parseISOWeekString(searchParams.get("week")) ??
      startOfISOWeek(new Date()),
  );
  const weekStartStr = toDateStr(weekStart);

  /** Skift uge og spejl den i URL'en (?week=YYYY-Www) så links kan deles. */
  function setWeekStart(next: Date) {
    setWeekStartState(next);
    // Bevar øvrige query-params — kun ?week= skiftes
    const params = new URLSearchParams(searchParams.toString());
    params.set("week", toISOWeekString(next));
    router.replace(`/dashboard/enterprise/timesheet?${params.toString()}`, {
      scroll: false,
    });
  }
  const todayStr = toDateStr(new Date());

  // Celler der er ved at blive redigeret (eller venter på server-svar)
  const [edits, setEdits] = useState<Record<string, string>>({});
  // Rækker tilføjet manuelt som endnu ikke har data på serveren
  const [extraRows, setExtraRows] = useState<
    Array<{ projectId: string; projectName: string }>
  >([]);
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  // Cellenote-editor (#467)
  const [noteEditor, setNoteEditor] = useState<{
    projectId: string;
    activityTypeId: string | null;
    date: string;
    hours: number;
    value: string;
  } | null>(null);
  // Bekræftelsesdialog ved indsend (#467): advarsler kan bekræftes, fejl blokerer
  const [submitDialog, setSubmitDialog] = useState<{
    warnings: string[];
    errors: string[];
  } | null>(null);
  // Arbejdstidsregler (E11, #469): seneste advarsler ved gem — vises som
  // banner indtil ugen skiftes eller brugeren lukker det
  const [complianceBanner, setComplianceBanner] = useState<string[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nulstil banneret ved ugeskift
  useEffect(() => setComplianceBanner([]), [weekStartStr]);
  // Mobil (#467): én dag ad gangen — start på i dag hvis den ligger i ugen
  const [mobileDayIndex, setMobileDayIndex] = useState(() => {
    const offset = Math.floor(
      (startOfISOWeek(new Date()).getTime() - weekStart.getTime()) / 86_400_000,
    );
    if (offset !== 0) return 0;
    const dow = new Date().getDay();
    return dow === 0 ? 6 : dow - 1;
  });

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.enterprise.getTimesheetWeek.useQuery({
    weekStart: weekStartStr,
  });

  const submitWeek = trpc.enterprise.submitTimesheetWeek.useMutation({
    onSuccess: (res) => {
      if (res.status === "submitted") {
        setSubmitDialog(null);
        utils.enterprise.getTimesheetWeek.invalidate({
          weekStart: weekStartStr,
        });
        toast.success(tx("submitted"));
        return;
      }
      // needs_confirmation / blocked: vis dialog med advarsler og fejl
      setSubmitDialog({ warnings: res.warnings, errors: res.errors });
    },
    onError: (e) => toast.error(e.message || tx("submitFailed")),
  });

  // Gem-status (#427): celler gemmes ved blur, så vis at det faktisk skete.
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const setCell = trpc.enterprise.setTimesheetCell.useMutation({
    onSuccess: (result, variables) => {
      setLastSavedAt(new Date());
      if (result.complianceWarnings.length > 0) {
        for (const w of result.complianceWarnings) toast.warning(w);
        setComplianceBanner(result.complianceWarnings);
      }
      if (variables.note !== undefined) setNoteEditor(null);
      const key = cellEditKey(
        variables.projectId,
        variables.activityTypeId ?? null,
        variables.date,
      );
      utils.enterprise.getTimesheetWeek
        .invalidate({ weekStart: weekStartStr })
        .then(() => {
          setEdits((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        });
      utils.enterprise.getBalance.invalidate();
    },
    onError: (error, variables) => {
      toast.error(error.message || tx("saveFailed"));
      const key = cellEditKey(
        variables.projectId,
        variables.activityTypeId ?? null,
        variables.date,
      );
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
  });

  // Fraværsrækker (#433): timer → 1-dags fraværsanmodning
  const setAbsence = trpc.enterprise.setAbsenceCell.useMutation({
    onSuccess: (result, variables) => {
      const key = `abs:${variables.absenceTypeId}:${variables.date}`;
      utils.enterprise.getTimesheetWeek
        .invalidate({ weekStart: weekStartStr })
        .then(() => {
          setEdits((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        });
      utils.enterprise.getBalance.invalidate();
      utils.enterprise.listRequests.invalidate();
      utils.enterprise.getVacationBalance.invalidate();
      if (result.status === "pending") {
        toast.success(tx("absenceRegisteredPending"));
      }
      if (result.warning) {
        toast.warning(tx("holidayNegative"));
      }
    },
    onError: (error, variables) => {
      toast.error(error.message || tx("absenceSaveFailed"));
      const key = `abs:${variables.absenceTypeId}:${variables.date}`;
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
  });

  const templatesQuery = trpc.enterprise.listTimesheetTemplates.useQuery();

  // Skjul/vis faste rækker — gælder alle uger, så invalidér bredt
  const hideProject = trpc.enterprise.hideTimesheetProject.useMutation({
    onSuccess: () => {
      utils.enterprise.getTimesheetWeek.invalidate();
      toast.success(tx("rowHidden"));
    },
    onError: (e) => toast.error(e.message || tx("hideFailed")),
  });
  const unhideProject = trpc.enterprise.unhideTimesheetProject.useMutation({
    onSuccess: () => {
      utils.enterprise.getTimesheetWeek.invalidate();
      toast.success(tx("rowShown"));
    },
    onError: (e) => toast.error(e.message || tx("showFailed")),
  });

  function afterFill(res: { filled: number; skipped: number }) {
    utils.enterprise.getTimesheetWeek.invalidate({ weekStart: weekStartStr });
    utils.enterprise.getBalance.invalidate();
    toast.success(
      res.skipped > 0
        ? tx("filledSkipped", { count: res.filled, skipped: res.skipped })
        : tx("filled", { count: res.filled }),
    );
  }

  const copyWeek = trpc.enterprise.copyTimesheetWeek.useMutation({
    onSuccess: afterFill,
    onError: (e) => toast.error(e.message || tx("copyFailed")),
  });
  const applyTemplate = trpc.enterprise.applyTimesheetTemplate.useMutation({
    onSuccess: afterFill,
    onError: (e) => toast.error(e.message || tx("templateApplyFailed")),
  });
  const saveTemplate = trpc.enterprise.saveTimesheetTemplate.useMutation({
    onSuccess: (r) => {
      templatesQuery.refetch();
      toast.success(r.updated ? tx("templateUpdated") : tx("templateSaved"));
    },
    onError: (e) => toast.error(e.message || tx("templateSaveFailed")),
  });

  const [exporting, setExporting] = useState(false);
  async function exportMyData() {
    setExporting(true);
    try {
      const year = weekStart.getFullYear();
      const from = `${year}-01-01`;
      const to = toDateStr(new Date());
      const res = await utils.enterprise.exportMyTimeData.fetch({ from, to });
      const header = tx("csvHeader");
      const lines = res.entries.map((e) =>
        [
          e.date,
          String(e.hours).replace(".", ","),
          escapeCsv(e.project, { alwaysQuote: true }),
          escapeCsv(e.activity, { alwaysQuote: true }),
          escapeCsv(e.description, { alwaysQuote: true }),
          e.source,
          e.approvalStatus ?? "",
        ].join(";"),
      );
      const blob = new Blob([`﻿${[header, ...lines].join("\r\n")}`], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = tx("csvFile", { year });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(
        res.truncated
          ? tx("exportedTruncated", { count: res.entries.length })
          : tx("exported", { count: res.entries.length }),
      );
    } catch {
      toast.error(tx("exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => toDateStr(addDays(weekStart, i))),
    [weekStart],
  );

  // Aktivitetstyper (#459): tom liste = ét-rækket grid pr. projekt som før
  const activityTypes = data?.activityTypes ?? [];
  const activityMode = activityTypes.length > 0;

  // Server-rækker + manuelt tilføjede (fjern extra når serveren kender dem).
  // Manuelle rækker får projektets tilladte aktiviteter (tom = alle).
  const rows = useMemo<GridRow[]>(() => {
    const serverRows = (data?.rows ?? []).filter((r) => r.projectId);
    const serverIds = new Set(serverRows.map((r) => r.projectId));
    const pending = extraRows.filter((r) => !serverIds.has(r.projectId));
    const allowedByProject = data?.allowedActivitiesByProject ?? {};
    const manualRows: GridRow[] = pending.flatMap((r): GridRow[] => {
      const base = {
        projectId: r.projectId as string | null,
        projectName: r.projectName,
        source: "manual" as RowSource,
        hidden: false,
        days: {} as Record<string, DayCell>,
      };
      if (!activityMode) {
        return [
          {
            ...base,
            activityTypeId: null,
            activityName: null,
            activityColor: null,
          },
        ];
      }
      const allowed = new Set(allowedByProject[r.projectId] ?? []);
      return activityTypes
        .filter((t) => allowed.size === 0 || allowed.has(t.id))
        .map((t) => ({
          ...base,
          activityTypeId: t.id,
          activityName: t.name,
          activityColor: t.color,
        }));
    });
    return [...serverRows, ...manualRows];
  }, [
    data?.rows,
    data?.allowedActivitiesByProject,
    extraRows,
    activityMode,
    activityTypes,
  ]);

  // Ekspand-/rækketilstand pr. org+bruger (#475) — læses efter mount (SSR
  // kender ikke localStorage) så snart brugeren er kendt. Resolver
  // useActiveOrganization() ikke, bruges en nøgle på brugeren alene ("_"),
  // så tilstanden aldrig går tabt i stilhed.
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const rowStateKey = session?.user?.id
    ? timesheetRowStateKey(activeOrg?.id ?? "_", session.user.id)
    : null;
  const [rowState, setRowState] = useState<TimesheetRowState>(EMPTY_ROW_STATE);
  useEffect(() => {
    if (!rowStateKey) return;
    setRowState(loadRowState(rowStateKey));
    try {
      // Forældreløs nøgle fra #459 (kollapsede projekter pr. browser)
      window.localStorage.removeItem("timesheet:collapsedProjects");
    } catch {
      // localStorage utilgængelig — intet at rydde op
    }
  }, [rowStateKey]);
  function updateRowState(
    update: (prev: TimesheetRowState) => TimesheetRowState,
  ) {
    setRowState((prev) => {
      const next = update(prev);
      if (rowStateKey) saveRowState(rowStateKey, next);
      return next;
    });
  }

  // Projektgrupper i serverens rækkefølge: kollapset uden timer, kun rækker
  // med timer (eller tilføjet af brugeren) synlige, resten via "+ aktivitet"
  const groups = useMemo(
    () => groupTimesheetRows(rows, { days, state: rowState, activityMode }),
    [rows, days, rowState, activityMode],
  );

  function toggleCollapsed(projectId: string) {
    const group = groups.find((g) => g.projectId === projectId);
    const nextOpen = !(group?.expanded ?? false);
    updateRowState((prev) => ({
      ...prev,
      toggles: { ...prev.toggles, [projectId]: nextOpen ? "open" : "closed" },
    }));
  }
  function addActivityRow(projectId: string, activityTypeId: string) {
    const key = timesheetRowKey(projectId, activityTypeId);
    updateRowState((prev) => ({
      toggles: { ...prev.toggles, [projectId]: "open" },
      added: prev.added.includes(key) ? prev.added : [...prev.added, key],
    }));
  }
  function removeAddedRow(projectId: string, activityTypeId: string | null) {
    const key = timesheetRowKey(projectId, activityTypeId);
    updateRowState((prev) => ({
      ...prev,
      added: prev.added.filter((k) => k !== key),
    }));
  }
  /** Tilladte aktiviteter for et projekt (tom liste på serveren = alle). */
  function allowedActivitiesFor(projectId: string) {
    const allowed = new Set(
      data?.allowedActivitiesByProject?.[projectId] ?? [],
    );
    return activityTypes.filter((t) => allowed.size === 0 || allowed.has(t.id));
  }

  // Flyt "(uden aktivitet)"-timer til en aktivitet (#475)
  const reassign = trpc.enterprise.reassignEntriesActivity.useMutation({
    onSuccess: (res, variables) => {
      utils.enterprise.getTimesheetWeek.invalidate({ weekStart: weekStartStr });
      const target = activityTypes.find(
        (t) => t.id === variables.toActivityTypeId,
      );
      toast.success(
        tx("movedTo", {
          count: res.moved,
          name: target?.name ?? tx("theActivity"),
        }),
      );
    },
    onError: (e) => toast.error(e.message || tx("moveFailed")),
  });

  const hiddenProjects = data?.hiddenProjects ?? [];

  const rowsWithoutProject = useMemo(
    () => (data?.rows ?? []).filter((r) => !r.projectId),
    [data?.rows],
  );

  const availableProjects = useMemo(() => {
    const used = new Set(rows.map((r) => r.projectId));
    return (data?.projects ?? []).filter((p) => !used.has(p.id));
  }, [data?.projects, rows]);

  const dayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const dateStr of days) {
      let sum = 0;
      for (const row of rows) sum += row.days[dateStr]?.total ?? 0;
      for (const row of rowsWithoutProject)
        sum += row.days[dateStr]?.total ?? 0;
      totals[dateStr] = Math.round(sum * 100) / 100;
    }
    return totals;
  }, [days, rows, rowsWithoutProject]);

  const weekTotal = days.reduce((sum, d) => sum + dayTotals[d], 0);
  const weekNorm = days.reduce((sum, d) => sum + (data?.norms?.[d] ?? 0), 0);
  const weekFlex = weekTotal - weekNorm;

  const holidayByDate = useMemo(
    () => new Map((data?.holidays ?? []).map((h) => [h.date, h])),
    [data?.holidays],
  );

  const absenceRows = data?.absenceRows ?? [];

  // Fravær tæller ikke med i "Registreret" — egen sum pr. dag
  const absenceDayTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const dateStr of days) {
      let sum = 0;
      for (const row of absenceRows) sum += row.days[dateStr]?.hours ?? 0;
      totals[dateStr] = Math.round(sum * 100) / 100;
    }
    return totals;
  }, [days, absenceRows]);
  const weekAbsence = days.reduce((sum, d) => sum + absenceDayTotals[d], 0);

  function commitAbsenceCell(absenceTypeId: string, date: string, raw: string) {
    const key = `abs:${absenceTypeId}:${date}`;
    const clearEdit = () =>
      setEdits((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    const parsed = parseHours(raw);
    if (parsed === null) {
      toast.error(tx("invalidHours"));
      clearEdit();
      return;
    }
    const current =
      absenceRows.find((r) => r.absenceTypeId === absenceTypeId)?.days[date]
        ?.hours ?? 0;
    if (Math.abs(parsed - current) < 0.005) {
      clearEdit();
      return;
    }
    setAbsence.mutate({ absenceTypeId, date, hours: parsed });
  }

  function clearEdit(key: string) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function commitCell(
    projectId: string,
    activityTypeId: string | null,
    date: string,
    raw: string,
  ) {
    const key = cellEditKey(projectId, activityTypeId, date);
    const parsed = parseHours(raw);
    if (parsed === null) {
      toast.error(tx("invalidHours"));
      clearEdit(key);
      return;
    }
    const currentTotal =
      rows.find(
        (r) => r.projectId === projectId && r.activityTypeId === activityTypeId,
      )?.days[date]?.total ?? 0;
    if (Math.abs(parsed - currentTotal) < 0.005) {
      clearEdit(key);
      return;
    }
    setCell.mutate({ projectId, activityTypeId, date, hours: parsed });
  }

  /** Redigerbar celle for én (projekt, aktivitet, dag) + note-ikon (#467). */
  function renderHourCell(row: GridRow, dateStr: string) {
    const projectId = row.projectId as string;
    const key = cellEditKey(projectId, row.activityTypeId, dateStr);
    const cell = row.days[dateStr];
    const total = cell?.total ?? 0;
    const serverValue = formatHours(total);
    const isSaving =
      setCell.isPending &&
      setCell.variables?.projectId === projectId &&
      (setCell.variables?.activityTypeId ?? null) === row.activityTypeId &&
      setCell.variables?.date === dateStr;
    return (
      <span className="inline-flex items-center gap-0.5">
        <HourCell
          value={edits[key] ?? serverValue}
          day={dateStr}
          disabled={isSaving || isLocked}
          onChange={(raw) => setEdits((prev) => ({ ...prev, [key]: raw }))}
          onCommit={(raw) => {
            if (key in edits)
              commitCell(projectId, row.activityTypeId, dateStr, raw);
          }}
          onCancel={() => clearEdit(key)}
        />
        <NoteButton
          note={cell?.note ?? null}
          hasHours={total > 0}
          disabled={isSaving || isLocked}
          onClick={() =>
            setNoteEditor({
              projectId,
              activityTypeId: row.activityTypeId,
              date: dateStr,
              hours: total,
              value: cell?.note ?? "",
            })
          }
        />
      </span>
    );
  }

  /** Gem noten fra editoren — timerne sendes uændret med (server kræver dem). */
  function saveNote(note: string) {
    if (!noteEditor) return;
    setCell.mutate({
      projectId: noteEditor.projectId,
      activityTypeId: noteEditor.activityTypeId,
      date: noteEditor.date,
      hours: noteEditor.hours,
      note: note.trim(),
    });
  }

  /** Redigerbar fraværscelle (#433) — delt af ugegrid og mobil dagsvisning. */
  function renderAbsenceCell(
    row: (typeof absenceRows)[number],
    dateStr: string,
  ) {
    const key = `abs:${row.absenceTypeId}:${dateStr}`;
    const cell = row.days[dateStr];
    const serverValue = formatHours(cell?.hours ?? 0);
    const value = edits[key] ?? serverValue;
    const isSaving =
      setAbsence.isPending &&
      setAbsence.variables?.absenceTypeId === row.absenceTypeId &&
      setAbsence.variables?.date === dateStr;
    const isPending = cell?.status === "pending";
    if (cell?.multiDay || cell?.closure) {
      return (
        <span
          title={
            cell.closure
              ? tx("absenceClosureTitle")
              : tx("absenceMultiDayTitle")
          }
          className="inline-block w-16 rounded-md border border-dashed border-gray-200 bg-gray-50 px-2 py-1.5 text-right text-sm tabular-nums text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
        >
          {serverValue}
        </span>
      );
    }
    return (
      <span className="relative inline-block">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          placeholder="–"
          disabled={isSaving || isLocked}
          onChange={(e) =>
            setEdits((prev) => ({
              ...prev,
              [key]: e.target.value,
            }))
          }
          onBlur={(e) => {
            if (key in edits)
              commitAbsenceCell(row.absenceTypeId, dateStr, e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              clearEdit(key);
              e.currentTarget.blur();
            }
          }}
          title={
            isPending
              ? tx("awaitingApproval")
              : tx("absenceCellHint", {
                  name: row.name,
                  full: formatHours(data?.dailyNorm ?? 0) || "7,4",
                  half: formatHours((data?.dailyNorm ?? 0) / 2) || "3,7",
                })
          }
          className={`w-16 rounded-md border bg-white px-2 py-1.5 text-right text-sm tabular-nums text-gray-900 shadow-sm placeholder:text-gray-300 hover:border-gray-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-600 dark:hover:border-gray-600 dark:disabled:bg-gray-900 ${
            isPending
              ? "border-amber-300 dark:border-amber-700"
              : "border-gray-200 dark:border-gray-700"
          }`}
        />
        {isPending && (
          <span
            title={tx("awaitingApproval")}
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white dark:ring-gray-900"
          />
        )}
      </span>
    );
  }

  function dayCellClass(dateStr: string, dayIndex: number): string {
    return `px-1 py-1 text-center ${
      dateStr === todayStr ? "bg-brand-50/60 dark:bg-tt-gran-lys" : ""
    } ${dayIndex >= 5 ? "bg-gray-50/60 dark:bg-gray-900/20" : ""}`;
  }

  const weekLabel = tx("weekLabel", {
    week: isoWeekNumber(weekStart),
    from: weekStart.toLocaleDateString(intl, {
      day: "numeric",
      month: "short",
    }),
    to: addDays(weekStart, 6).toLocaleDateString(intl, {
      day: "numeric",
      month: "short",
    }),
  });

  const weekStatus = data?.weekStatus ?? null;
  const rollingLocked = Boolean(data?.rollingLocked);
  const autoLocked = Boolean(data?.autoLocked);
  const periodLocked = Boolean(data?.periodLocked);
  const isLocked =
    weekStatus === "submitted" ||
    weekStatus === "approved" ||
    rollingLocked ||
    autoLocked ||
    periodLocked;
  const mobileDate = days[Math.min(mobileDayIndex, 6)];

  return (
    <div className="space-y-6">
      <PageHeader title={tx("title")} />

      {/* Uge-navigation + saldi */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            aria-label={tx("prevWeek")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(startOfISOWeek(new Date()))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {tx("today")}
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            aria-label={tx("nextWeek")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <label className="ml-1 flex items-center gap-1.5">
            <span className="sr-only">{tx("pickWeek")}</span>
            <CalendarDays className="h-4 w-4 text-gray-400" />
            <input
              type="week"
              value={toISOWeekString(weekStart)}
              onChange={(e) => {
                const monday = parseISOWeekString(e.target.value);
                if (monday) setWeekStart(monday);
              }}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900"
            />
          </label>
          <span className="ml-1 text-sm font-medium text-gray-700 dark:text-gray-300">
            {weekLabel}
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <span
            aria-live="polite"
            className="text-xs text-gray-500 dark:text-gray-400"
          >
            {setCell.isPending
              ? tx("saving")
              : lastSavedAt
                ? tx("allSaved", {
                    time: lastSavedAt.toLocaleTimeString(intl, {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  })
                : null}
          </span>
          <div>
            <span className="text-gray-500 dark:text-gray-400">
              {tx("norm")}
            </span>
            <span className="font-semibold">
              {tx("normValue", { value: formatTotal(data?.weeklyHours ?? 37) })}
            </span>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">
              {tx("flexBalance")}
            </span>
            <span
              className={`font-semibold ${
                (data?.flexBalance ?? 0) >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {(data?.flexBalance ?? 0) >= 0 ? "+" : ""}
              {tx("hoursValue", { value: formatTotal(data?.flexBalance ?? 0) })}
            </span>
          </div>

          {/* Godkendelsesstatus + indsend */}
          {weekStatus === "approved" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {tx("approved")}
            </span>
          ) : weekStatus === "submitted" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-medium text-brand-800 dark:bg-tt-gran-lys dark:text-brand-300">
              <Clock className="h-3.5 w-3.5" />
              {tx("awaitingApprovalBadge")}
            </span>
          ) : (
            <button
              type="button"
              onClick={() =>
                submitWeek.mutate({ weekStart: weekStartStr, confirm: false })
              }
              disabled={submitWeek.isPending || isLoading || weekTotal <= 0}
              className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-3 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {weekStatus === "rejected" || weekStatus === "reopened"
                ? tx("resubmit")
                : tx("submitWeek")}
            </button>
          )}
        </div>
      </div>

      {/* Værktøjer: kopiér sidste uge, skabeloner, eksport */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => copyWeek.mutate({ weekStart: weekStartStr })}
          disabled={isLocked || copyWeek.isPending}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          <Copy className="h-4 w-4" />
          {tx("copyLastWeek")}
        </button>

        <select
          value=""
          disabled={
            isLocked ||
            applyTemplate.isPending ||
            (templatesQuery.data?.length ?? 0) === 0
          }
          onChange={(e) => {
            if (e.target.value) {
              applyTemplate.mutate({
                templateId: e.target.value,
                weekStart: weekStartStr,
              });
              e.target.value = "";
            }
          }}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="">
            {(templatesQuery.data?.length ?? 0) === 0
              ? tx("noTemplates")
              : tx("applyTemplate")}
          </option>
          {templatesQuery.data?.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tx("templateOption", {
                name: tpl.name,
                hours: formatTotal(tpl.totalHours),
              })}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => {
            const name = window.prompt(tx("templateNamePrompt"));
            if (name?.trim()) {
              saveTemplate.mutate({
                name: name.trim(),
                weekStart: weekStartStr,
              });
            }
          }}
          disabled={saveTemplate.isPending || weekTotal <= 0}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          <Save className="h-4 w-4" />
          {tx("saveAsTemplate")}
        </button>

        <button
          type="button"
          onClick={exportMyData}
          disabled={exporting}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          <Download className="h-4 w-4" />
          {exporting ? tx("exporting") : tx("exportMyHours")}
        </button>
      </div>

      {weekStatus === "reopened" && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {tx.rich("reopenedBanner", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>
      )}

      {complianceBanner.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <strong>{tx("complianceRules")}</strong>
            <ul className="mt-1 space-y-0.5">
              {complianceBanner.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => setComplianceBanner([])}
            className="text-xs underline"
          >
            {tx("hide")}
          </button>
        </div>
      )}

      {rollingLocked && !isLoading && (
        <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{tx("rollingLocked", { weeks: data?.lockAfterWeeks ?? 0 })}</p>
        </div>
      )}

      {autoLocked && !isLoading && (
        <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {tx("autoLocked", {
              day:
                data?.autoLockWeekday && data.autoLockWeekday >= 1
                  ? tc(`weekdayLong.${data.autoLockWeekday}`)
                  : tx("autoLockedGeneric"),
            })}
          </p>
        </div>
      )}

      {periodLocked && !isLoading && (
        <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {tx.rich("periodLocked", {
              link: (chunks) => (
                <Link
                  href="/dashboard/enterprise/period-closing"
                  className="underline"
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      )}

      {weekStatus === "rejected" && data?.rejectionReason && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {tx.rich("rejectedBanner", {
              reason: data.rejectionReason,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
            <span className="block">{tx("rejectedFix")}</span>
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <InlineSpinner />
        </div>
      ) : (
        <>
          {/* Mobil (#467): én dag ad gangen i stedet for vandret scroll */}
          <div className="space-y-3 sm:hidden">
            <div className="flex items-center justify-between rounded-xl border border-gray-200/80 bg-white px-2 py-2 dark:border-gray-800 dark:bg-gray-900">
              <button
                type="button"
                onClick={() => setMobileDayIndex((i) => Math.max(0, i - 1))}
                disabled={mobileDayIndex === 0}
                className="rounded-lg border border-gray-200 p-2 disabled:opacity-40 dark:border-gray-700"
                aria-label={tx("prevDay")}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-center">
                <div
                  className={`text-sm font-semibold ${
                    mobileDate === todayStr
                      ? "text-brand-700 dark:text-brand-300"
                      : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  {fmtDayLabel(mobileDate)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {localizeMaybe(holidayByDate.get(mobileDate)?.name) ??
                    tx("normOfDay", {
                      value: formatTotal(data?.norms?.[mobileDate] ?? 0),
                    })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileDayIndex((i) => Math.min(6, i + 1))}
                disabled={mobileDayIndex === 6}
                className="rounded-lg border border-gray-200 p-2 disabled:opacity-40 dark:border-gray-700"
                aria-label={tx("nextDay")}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-1">
              {days.map((dateStr, i) => (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => setMobileDayIndex(i)}
                  aria-pressed={i === mobileDayIndex}
                  className={`flex-1 rounded-md py-1 text-[11px] font-medium ${
                    i === mobileDayIndex
                      ? "bg-tt-gran text-tt-paa-gran"
                      : dayTotals[dateStr] > 0
                        ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        : "bg-gray-50 text-gray-400 dark:bg-gray-900 dark:text-gray-500"
                  }`}
                >
                  {tDays(DAY_KEYS[i])}
                </button>
              ))}
            </div>

            <div className="divide-y divide-gray-100 rounded-xl border border-gray-200/80 bg-white text-sm dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900">
              {rows.length === 0 && rowsWithoutProject.length === 0 && (
                <p className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                  {tx("noRowsMobile")}
                </p>
              )}
              {groups.map((group) => (
                <div key={group.projectId} className="px-3 py-2">
                  <div className="mb-1 font-medium text-gray-900 dark:text-gray-100">
                    {group.projectName}
                    {group.source === "all" && (
                      <span className="ml-1 text-[10px] font-normal text-gray-400">
                        {tx("allBadge")}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {group.rows.map((row) => (
                      <div
                        key={`${group.projectId}|${row.activityTypeId ?? ""}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="flex min-w-0 items-center gap-2 text-gray-700 dark:text-gray-300">
                          {row.activityColor && (
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: row.activityColor }}
                              aria-hidden="true"
                            />
                          )}
                          <span className="truncate">
                            {activityMode ? row.activityName : tx("hoursLabel")}
                          </span>
                        </span>
                        {renderHourCell(row, mobileDate)}
                      </div>
                    ))}
                    {activityMode && !isLocked && group.addable.length > 0 && (
                      <AddActivitySelect
                        compact
                        options={group.addable}
                        onAdd={(id) => addActivityRow(group.projectId, id)}
                      />
                    )}
                  </div>
                </div>
              ))}
              {rowsWithoutProject.map((row) => (
                <div
                  key="no-project"
                  className="flex items-center justify-between px-3 py-2 text-gray-500 italic dark:text-gray-400"
                >
                  <span>{tx("noProject")}</span>
                  <span className="tabular-nums">
                    {formatHours(row.days[mobileDate]?.total ?? 0) || "–"}
                  </span>
                </div>
              ))}
              {absenceRows.length > 0 && (
                <div className="px-3 py-2">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {tx("absence")}
                  </div>
                  <div className="space-y-1.5">
                    {absenceRows.map((row) => (
                      <div
                        key={`abs:${row.absenceTypeId}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="flex min-w-0 items-center gap-2 text-gray-700 dark:text-gray-300">
                          <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: row.color }}
                            aria-hidden="true"
                          />
                          <span className="truncate">{row.name}</span>
                        </span>
                        {renderAbsenceCell(row, mobileDate)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-1 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                <div className="flex justify-between font-medium text-gray-900 dark:text-gray-100">
                  <span>{tx("loggedToday")}</span>
                  <span className="tabular-nums">
                    {tx("hoursValue", {
                      value: formatTotal(dayTotals[mobileDate]),
                    })}
                  </span>
                </div>
                {absenceRows.length > 0 && (
                  <div className="flex justify-between">
                    <span>{tx("absence")}</span>
                    <span className="tabular-nums">
                      {tx("hoursValue", {
                        value: formatTotal(absenceDayTotals[mobileDate]),
                      })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>{tx("flexToday")}</span>
                  <span className="tabular-nums">
                    {dayTotals[mobileDate] - (data?.norms?.[mobileDate] ?? 0) >
                    0
                      ? "+"
                      : ""}
                    {tx("hoursValue", {
                      value: formatTotal(
                        dayTotals[mobileDate] -
                          (data?.norms?.[mobileDate] ?? 0),
                      ),
                    })}
                  </span>
                </div>
                <div className="flex justify-between border-t border-gray-100 pt-1 dark:border-gray-800">
                  <span>{tx("weekTotal")}</span>
                  <span className="tabular-nums">
                    {tx("weekTotalValue", {
                      total: formatTotal(weekTotal),
                      norm: formatTotal(weekNorm),
                    })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-gray-200/80 bg-white sm:block dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400">
                    {tx("colProject")}
                  </th>
                  {days.map((dateStr, i) => {
                    const isToday = dateStr === todayStr;
                    const isWeekend = i >= 5;
                    const holiday = holidayByDate.get(dateStr);
                    return (
                      <th
                        key={dateStr}
                        className={`px-2 py-3 text-center font-medium ${
                          isToday
                            ? "bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300"
                            : isWeekend || holiday
                              ? "text-gray-400 dark:text-gray-500"
                              : "text-gray-500 dark:text-gray-400"
                        }`}
                        title={
                          holiday ? localizeDayOffName(holiday.name) : undefined
                        }
                      >
                        <div>{tDays(DAY_KEYS[i])}</div>
                        <div className="text-xs font-normal">
                          {Number(dateStr.slice(8, 10))}/
                          {Number(dateStr.slice(5, 7))}
                        </div>
                        {holiday && (
                          <div className="mt-0.5 truncate text-[10px] font-normal text-red-500 dark:text-red-400">
                            {localizeDayOffName(holiday.name)}
                          </div>
                        )}
                      </th>
                    );
                  })}
                  <th className="px-4 py-3 text-right font-medium text-gray-500 dark:text-gray-400">
                    {tx("colTotal")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && rowsWithoutProject.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                    >
                      {tx("noRowsDesktop")}
                    </td>
                  </tr>
                )}

                {groups.map((group) => {
                  const { projectId } = group;
                  const groupDayTotals = days.map((d) =>
                    group.rows.reduce(
                      (sum, r) => sum + (r.days[d]?.total ?? 0),
                      0,
                    ),
                  );
                  const groupTotal = group.total;
                  const isEmptyGroup = !group.hasHours;
                  const rowMenu = isEmptyGroup && !isLocked && (
                    <RowMenu
                      source={group.source}
                      disabled={hideProject.isPending}
                      onHide={() => hideProject.mutate({ projectId })}
                      onRemove={() =>
                        setExtraRows((prev) =>
                          prev.filter((r) => r.projectId !== projectId),
                        )
                      }
                    />
                  );
                  const allBadge = group.source === "all" && (
                    <span
                      className="text-[10px] font-normal text-gray-400 dark:text-gray-500"
                      title={tx("allBadgeTitle")}
                    >
                      {tx("allBadge")}
                    </span>
                  );

                  // Uden aktivitetstyper: én flad række pr. projekt (som før #459)
                  if (!activityMode) {
                    const row = group.rows[0];
                    return (
                      <tr
                        key={projectId}
                        className="group border-b border-gray-100 dark:border-gray-700/50"
                      >
                        <td className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100">
                          <div className="flex items-center gap-1">
                            <span>{group.projectName}</span>
                            {allBadge}
                            {rowMenu}
                          </div>
                        </td>
                        {days.map((dateStr, i) => (
                          <td
                            key={dateStr}
                            className={dayCellClass(dateStr, i)}
                          >
                            {renderHourCell(row, dateStr)}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right font-medium tabular-nums">
                          {formatTotal(groupTotal)}
                        </td>
                      </tr>
                    );
                  }

                  // Med aktivitetstyper: projektet som gruppe-overskrift med
                  // indrykkede aktivitetsrækker. Kollapset som standard uden
                  // timer; kun rækker med timer vises (#475), husket pr. org+bruger
                  const isCollapsed = !group.expanded;
                  return (
                    <Fragment key={projectId}>
                      <tr className="border-b border-gray-100 bg-gray-50/40 dark:border-gray-700/50 dark:bg-gray-900/20">
                        <td className="px-2 py-1.5 font-medium text-gray-900 dark:text-gray-100">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleCollapsed(projectId)}
                              aria-expanded={!isCollapsed}
                              aria-label={
                                isCollapsed
                                  ? tx("showActivities", {
                                      project: group.projectName,
                                    })
                                  : tx("hideActivities", {
                                      project: group.projectName,
                                    })
                              }
                              className="rounded p-0.5 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                            >
                              <ChevronDown
                                className={`h-4 w-4 transition-transform ${
                                  isCollapsed ? "-rotate-90" : ""
                                }`}
                              />
                            </button>
                            <span>{group.projectName}</span>
                            {allBadge}
                            <span className="text-[10px] font-normal text-gray-400 dark:text-gray-500">
                              {tx("activityCount", {
                                count: group.activityCount,
                              })}
                            </span>
                            {rowMenu}
                          </div>
                        </td>
                        {days.map((dateStr, i) => (
                          <td
                            key={dateStr}
                            className={`${dayCellClass(dateStr, i)} py-1.5 text-xs tabular-nums text-gray-500 dark:text-gray-400`}
                          >
                            {formatHours(groupDayTotals[i]) || "–"}
                          </td>
                        ))}
                        <td className="px-4 py-1.5 text-right font-medium tabular-nums">
                          {formatTotal(groupTotal)}
                        </td>
                      </tr>
                      {!isCollapsed &&
                        group.rows.map((row) => {
                          const rowTotal = days.reduce(
                            (sum, d) => sum + (row.days[d]?.total ?? 0),
                            0,
                          );
                          const isLegacy = row.activityTypeId === null;
                          const isAddedEmpty =
                            rowTotal < 0.005 &&
                            rowState.added.includes(
                              timesheetRowKey(projectId, row.activityTypeId),
                            );
                          return (
                            <tr
                              key={`${projectId}|${row.activityTypeId ?? ""}`}
                              className="group border-b border-gray-100 dark:border-gray-700/50"
                            >
                              <td
                                className={`py-1.5 pl-9 pr-4 text-sm ${
                                  isLegacy
                                    ? "text-gray-500 italic dark:text-gray-400"
                                    : "text-gray-700 dark:text-gray-300"
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  {row.activityColor && (
                                    <span
                                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                                      style={{
                                        backgroundColor: row.activityColor,
                                      }}
                                      aria-hidden="true"
                                    />
                                  )}
                                  <span
                                    title={
                                      isLegacy ? tx("legacyTitle") : undefined
                                    }
                                  >
                                    {row.activityName}
                                  </span>
                                  {isLegacy && !isLocked && (
                                    <label className="inline-flex items-center gap-1 not-italic">
                                      <ArrowRightLeft className="h-3 w-3 text-gray-400" />
                                      <span className="sr-only">
                                        {tx("moveHoursToActivity")}
                                      </span>
                                      <select
                                        value=""
                                        disabled={reassign.isPending}
                                        onChange={(e) => {
                                          if (!e.target.value) return;
                                          reassign.mutate({
                                            projectId,
                                            fromActivityTypeId: null,
                                            toActivityTypeId: e.target.value,
                                            weekStart: weekStartStr,
                                          });
                                        }}
                                        title={tx("moveWeekTitle")}
                                        className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-600 hover:border-gray-300 focus:border-brand-500 focus:outline-none disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                                      >
                                        <option value="">
                                          {tx("moveToActivity")}
                                        </option>
                                        {allowedActivitiesFor(projectId).map(
                                          (ty) => (
                                            <option key={ty.id} value={ty.id}>
                                              {ty.name}
                                            </option>
                                          ),
                                        )}
                                      </select>
                                    </label>
                                  )}
                                  {isAddedEmpty && !isLocked && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeAddedRow(
                                          projectId,
                                          row.activityTypeId,
                                        )
                                      }
                                      aria-label={tx("removeRowLabel", {
                                        name: row.activityName ?? "",
                                      })}
                                      title={tx("removeEmptyRow")}
                                      className="rounded p-0.5 text-gray-300 opacity-0 hover:bg-gray-100 hover:text-gray-600 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-gray-800"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                              {days.map((dateStr, i) => (
                                <td
                                  key={dateStr}
                                  className={dayCellClass(dateStr, i)}
                                >
                                  {renderHourCell(row, dateStr)}
                                </td>
                              ))}
                              <td className="px-4 py-1.5 text-right tabular-nums text-gray-600 dark:text-gray-300">
                                {formatTotal(rowTotal)}
                              </td>
                            </tr>
                          );
                        })}
                      {!isCollapsed &&
                        !isLocked &&
                        group.addable.length > 0 && (
                          <tr className="border-b border-gray-100 dark:border-gray-700/50">
                            <td colSpan={9} className="py-1 pl-9 pr-4">
                              <AddActivitySelect
                                options={group.addable}
                                onAdd={(id) => addActivityRow(projectId, id)}
                              />
                            </td>
                          </tr>
                        )}
                    </Fragment>
                  );
                })}

                {/* Tid uden projekt — read-only (redigeres under Tidsregistrering) */}
                {rowsWithoutProject.map((row) => {
                  const rowTotal = days.reduce(
                    (sum, d) => sum + (row.days[d]?.total ?? 0),
                    0,
                  );
                  return (
                    <tr
                      key="no-project"
                      className="border-b border-gray-100 dark:border-gray-700/50"
                    >
                      <td className="px-4 py-2 text-gray-500 italic dark:text-gray-400">
                        {tx("noProject")}
                      </td>
                      {days.map((dateStr) => (
                        <td
                          key={dateStr}
                          className="px-2 py-2 text-center text-gray-500 tabular-nums dark:text-gray-400"
                        >
                          {formatHours(row.days[dateStr]?.total ?? 0) || "–"}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right text-gray-500 tabular-nums dark:text-gray-400">
                        {formatTotal(rowTotal)}
                      </td>
                    </tr>
                  );
                })}

                {/* Fravær (#433): én redigerbar række pr. fraværstype. Timer ≥
                  dagsnorm = hel dag, derunder = halv dag, tom = slet. */}
                {absenceRows.length > 0 && (
                  <tr className="border-b border-gray-100 bg-gray-50/50 dark:border-gray-700/50 dark:bg-gray-900/20">
                    <td
                      colSpan={9}
                      className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                    >
                      {tx("absenceHeader")}
                      <span className="ml-2 font-normal normal-case tracking-normal text-gray-400 dark:text-gray-500">
                        {tx("absenceRule", {
                          value: formatHours(data?.dailyNorm ?? 0) || "0",
                        })}
                      </span>
                    </td>
                  </tr>
                )}
                {absenceRows.map((row) => {
                  const rowTotal = days.reduce(
                    (sum, d) => sum + (row.days[d]?.hours ?? 0),
                    0,
                  );
                  return (
                    <tr
                      key={`abs:${row.absenceTypeId}`}
                      className="border-b border-gray-100 dark:border-gray-700/50"
                    >
                      <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: row.color }}
                            aria-hidden="true"
                          />
                          <span>{row.name}</span>
                          {row.requiresApproval && (
                            <span
                              className="text-[10px] text-gray-400 dark:text-gray-500"
                              title={tx("requiresApprovalTitle")}
                            >
                              {tx("requiresApproval")}
                            </span>
                          )}
                        </div>
                      </td>
                      {days.map((dateStr, i) => (
                        <td key={dateStr} className={dayCellClass(dateStr, i)}>
                          {renderAbsenceCell(row, dateStr)}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right text-gray-500 tabular-nums dark:text-gray-400">
                        {formatTotal(rowTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 font-medium dark:border-gray-700">
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                    {tx("footLogged")}
                  </td>
                  {days.map((dateStr) => (
                    <td
                      key={dateStr}
                      className="px-2 py-2 text-center tabular-nums"
                    >
                      {formatTotal(dayTotals[dateStr])}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatTotal(weekTotal)}
                  </td>
                </tr>
                {absenceRows.length > 0 && (
                  <tr className="text-gray-500 dark:text-gray-400">
                    <td className="px-4 py-1.5">{tx("footAbsence")}</td>
                    {days.map((dateStr) => (
                      <td
                        key={dateStr}
                        className="px-2 py-1.5 text-center tabular-nums"
                      >
                        {formatTotal(absenceDayTotals[dateStr])}
                      </td>
                    ))}
                    <td className="px-4 py-1.5 text-right tabular-nums">
                      {formatTotal(weekAbsence)}
                    </td>
                  </tr>
                )}
                <tr className="text-gray-500 dark:text-gray-400">
                  <td className="px-4 py-1.5">{tx("footNorm")}</td>
                  {days.map((dateStr) => (
                    <td
                      key={dateStr}
                      className="px-2 py-1.5 text-center tabular-nums"
                    >
                      {formatTotal(data?.norms?.[dateStr] ?? 0)}
                    </td>
                  ))}
                  <td className="px-4 py-1.5 text-right tabular-nums">
                    {formatTotal(weekNorm)}
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                    {tx("footFlex")}
                  </td>
                  {days.map((dateStr) => {
                    const delta =
                      dayTotals[dateStr] - (data?.norms?.[dateStr] ?? 0);
                    return (
                      <td
                        key={dateStr}
                        className={`px-2 py-2 text-center tabular-nums ${
                          Math.abs(delta) < 0.005
                            ? "text-gray-400 dark:text-gray-500"
                            : delta > 0
                              ? "text-green-600 dark:text-green-400"
                              : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {delta > 0 ? "+" : ""}
                        {formatTotal(delta)}
                      </td>
                    );
                  })}
                  <td
                    className={`px-4 py-2 text-right font-medium tabular-nums ${
                      weekFlex >= 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {weekFlex > 0 ? "+" : ""}
                    {formatTotal(weekFlex)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {/* Tilføj projekt-række */}
      {!isLoading && (
        <div className="flex items-center gap-3">
          {showProjectPicker ? (
            <select
              defaultValue=""
              onChange={(e) => {
                const project = availableProjects.find(
                  (p) => p.id === e.target.value,
                );
                if (project) {
                  setExtraRows((prev) => [
                    ...prev,
                    { projectId: project.id, projectName: project.name },
                  ]);
                  // Et manuelt tilføjet projekt skal ses med det samme
                  updateRowState((prev) => ({
                    ...prev,
                    toggles: { ...prev.toggles, [project.id]: "open" },
                  }));
                }
                setShowProjectPicker(false);
              }}
              onBlur={() => setShowProjectPicker(false)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            >
              <option value="" disabled>
                {tx("chooseProject")}
              </option>
              {availableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => setShowProjectPicker(true)}
              disabled={availableProjects.length === 0 || isLocked}
              className="inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-gray-400 hover:text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <Plus className="h-4 w-4" />
              {tx("addProjectRow")}
            </button>
          )}
          {hiddenProjects.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <Eye className="h-4 w-4" />
              {showHidden
                ? tx("hideList")
                : tx("showHidden", { count: hiddenProjects.length })}
            </button>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {tx("enterHint")}
          </p>
        </div>
      )}

      {/* Cellenote-editor (#467) */}
      {noteEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200/80 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {tx("noteTitle", { day: fmtDayLabel(noteEditor.date) })}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {(() => {
                const noteRow = rows.find(
                  (r) =>
                    r.projectId === noteEditor.projectId &&
                    r.activityTypeId === noteEditor.activityTypeId,
                );
                const values = {
                  project: noteRow?.projectName ?? "",
                  activity: noteRow?.activityName ?? "",
                  hours: formatHours(noteEditor.hours) || "0",
                };
                return activityMode
                  ? tx("noteDescriptionActivity", values)
                  : tx("noteDescription", values);
              })()}
            </p>
            <textarea
              value={noteEditor.value}
              onChange={(e) =>
                setNoteEditor({ ...noteEditor, value: e.target.value })
              }
              maxLength={TIMESHEET_NOTE_MAX_LENGTH}
              placeholder={tx("notePlaceholder")}
              rows={3}
              // biome-ignore lint/a11y/noAutofocus: dialogen åbnes af et klik og skal kunne tastes i med det samme
              autoFocus
              className="mt-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <div className="mt-1 text-right text-[11px] text-gray-400">
              {noteEditor.value.length}/{TIMESHEET_NOTE_MAX_LENGTH}
            </div>
            <div className="mt-3 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => saveNote("")}
                disabled={setCell.isPending || noteEditor.value.trim() === ""}
                className="rounded-lg px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                {tx("removeNote")}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNoteEditor(null)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  {tx("cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => saveNote(noteEditor.value)}
                  disabled={setCell.isPending || noteEditor.hours <= 0}
                  className="rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                >
                  {setCell.isPending ? tx("saving") : tx("saveNote")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bekræftelse ved indsend (#467) */}
      {submitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-200/80 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {submitDialog.errors.length > 0
                ? tx("cannotSubmit")
                : tx("submitAnyway")}
            </h3>
            {submitDialog.errors.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-sm text-red-800 dark:text-red-300">
                {submitDialog.errors.map((e) => (
                  <li key={e} className="flex items-start gap-2">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
            )}
            {submitDialog.warnings.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-sm text-amber-800 dark:text-amber-300">
                {submitDialog.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              {submitDialog.errors.length > 0
                ? tx("fixAndRetry")
                : tx("checkHours")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubmitDialog(null)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                {submitDialog.errors.length > 0 ? tx("close") : tx("cancel")}
              </button>
              {submitDialog.errors.length === 0 && (
                <button
                  type="button"
                  onClick={() =>
                    submitWeek.mutate({
                      weekStart: weekStartStr,
                      confirm: true,
                    })
                  }
                  disabled={submitWeek.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-3 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  {tx("submitAnywayButton")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Skjulte faste rækker — gendan */}
      {!isLoading && showHidden && hiddenProjects.length > 0 && (
        <div className="rounded-xl border border-gray-200/80 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
            {tx("hiddenRows")}
          </h3>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {hiddenProjects.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="text-gray-700 dark:text-gray-300">
                  {p.name}
                </span>
                <button
                  type="button"
                  disabled={unhideProject.isPending}
                  onClick={() => unhideProject.mutate({ projectId: p.id })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {tx("showAgain")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function TimesheetPage() {
  return (
    <ModuleGuard module="enterprise">
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <InlineSpinner />
          </div>
        }
      >
        <TimesheetPageContent />
      </Suspense>
    </ModuleGuard>
  );
}
