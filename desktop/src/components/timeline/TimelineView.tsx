import { useNavigate } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  CheckCheck,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Settings,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type CreateRuleInput,
  RuleDialog,
} from "@/components/settings/RuleDialog";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { LoadError } from "@/components/ui/LoadError";
import { useListKeyboard } from "@/hooks/useListKeyboard";
import { useMergeGapSeconds } from "@/hooks/useMergeGapSeconds";
import { getOfflineMessage, isNetworkError } from "@/hooks/useNetworkStatus";
import {
  type ActivityBlock as MergedActivityBlock,
  mergeActivitiesIntoBlocks,
} from "@/lib/activityBlocks";
import {
  bulkAssignProject,
  bulkConfirmActivities,
  bulkDelete,
  bulkMarkNonBillable,
  kunFejlede,
} from "@/lib/bulkActions";
import {
  formatDate,
  formatDuration,
  formatTime,
  toLocalDateStr,
} from "@/lib/format";
import { fletPomodoroInd, type PomodoroFase } from "@/lib/pomodoro";
import { captureError } from "@/lib/sentry";
import { tauriInvoke } from "@/lib/tauri";
import { activeActivityAnnouncement } from "@/lib/timelineKeyboard";
import type { Activity, Project } from "@/lib/types";
import { toast } from "@/stores/toastStore";
import { ActivityBlock } from "./ActivityBlock";
import { BrowserUrlHint } from "./BrowserUrlHint";
import { ConfirmDialog } from "./ConfirmDialog";
import { DaySummary } from "./DaySummary";
import { PomodoroFaseRække } from "./PomodoroFaseRække";

/** Extract a bare domain (no www.) from a URL, or null if unparseable. */
function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Move a date by whole days. Uses setDate rather than adding milliseconds, so
 * a day across a DST boundary is still one calendar day, not 23 or 25 hours.
 */
function shiftDay(date: Date, delta: -1 | 1): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

/**
 * Prefill a classification rule from an activity's own columns. Picks the most
 * specific reliable field available: git repo → url domain → app name.
 */
function buildRuleInitialFromActivity(a: Activity): Partial<CreateRuleInput> {
  let conditionType = "app_name";
  let conditionOp = "equals";
  let conditionValue = a.app_name ?? "";
  if (a.git_repo) {
    conditionType = "git_repo";
    conditionOp = "equals";
    conditionValue = a.git_repo;
  } else if (a.url) {
    const domain = domainFromUrl(a.url);
    if (domain) {
      conditionType = "url";
      conditionOp = "contains";
      conditionValue = domain;
    }
  }
  return {
    name: a.app_name ?? conditionValue,
    condition_type: conditionType,
    condition_op: conditionOp,
    condition_value: conditionValue,
    target_project_id: a.project_id ?? null,
    target_category: a.category ?? null,
  };
}

interface AiConfig {
  provider: string;
  api_key: string | null;
  model: string | null;
  base_url: string | null;
}

interface ClassificationResult {
  classifications: Array<{
    index: number;
    project_id: string | null;
    project_name: string | null;
    category: string;
    confidence: number;
    billable: boolean;
    reasoning: string;
  }>;
}

export function TimelineView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [activities, setActivities] = useState<Activity[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmActivity, setConfirmActivity] = useState<Activity | null>(null);
  const [deleteActivity, setDeleteActivity] = useState<Activity | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [ruleInitial, setRuleInitial] =
    useState<Partial<CreateRuleInput> | null>(null);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [confirmingBlockKey, setConfirmingBlockKey] = useState<string | null>(
    null,
  );
  const [classifying, setClassifying] = useState(false);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const hasAutoClassified = useRef<string | null>(null);
  // Dagens gennemførte pomodoro-faser. De er deres egen tilstand med deres egen
  // fejl, fordi de er en *tilføjelse* til dagen: en fældet læsning af faserne må
  // ikke tømme aktiviteterne, og en fejl må ikke se ud som «dagen er væk».
  const [pomodoroFaser, setPomodoroFaser] = useState<PomodoroFase[]>([]);
  const [pomodoroFejl, setPomodoroFejl] = useState(false);
  // En færdig hentning for *denne* dag. Uden den kan et langsomt svar for i går
  // nå at skrive dagens faser væk, fordi brugeren klikkede videre mens det hang i
  // luften — samme forveksling de tre kalendervisninger blev rettet for (K26).
  const pomodoroAnkommet = useRef<string | null>(null);

  // Bulk selection state
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkAssignDropdownOpen, setBulkAssignDropdownOpen] = useState(false);

  const dateStr = toLocalDateStr(selectedDate);
  const isToday = dateStr === toLocalDateStr(new Date());

  // Non-idle activities for keyboard navigation
  const nonIdleActivities = activities.filter((a) => !a.is_idle);

  // Merge adjacent unconfirmed activities into contiguous blocks (same engine
  // as DayView/WeekView) so a work session reads as one group in the list.
  const maxGapSeconds = useMergeGapSeconds();
  const mergedBlocks = useMemo(
    () => mergeActivitiesIntoBlocks(activities, { maxGapSeconds }),
    [activities, maxGapSeconds],
  );

  // Blokkene og faserne i én kronologisk række. `fletPomodoroInd` er ren, så
  // rækkefølgen kan dømmes i `pomodoro.test.ts` uden at en DOM-render skal
  // finde ud af den.
  const tidslinjeRækker = useMemo(
    () => fletPomodoroInd(mergedBlocks, pomodoroFaser),
    [mergedBlocks, pomodoroFaser],
  );

  /**
   * Henter dagens gennemførte pomodoro-faser.
   *
   * Nummereret med en ankomstdag, så et svar for en dag brugeren er gået videre
   * fra ikke kan skrive den nye dags faser væk — og et *fejl* for en gammel dag
   * heller ikke må slå en god hentning ned. Samme mønster som `K26`s
   * kalendervisninger.
   */
  const hentPomodoroFaser = useCallback(async (dag: string) => {
    try {
      const svar = await tauriInvoke<unknown>("list_pomodoro_sessions", {
        day: dag,
      });
      if (pomodoroAnkommet.current !== dag) return;
      // **Svaret skal være en liste.** `tauriInvoke` er typet, men typen er et
      // løfte, ikke en garanti: en fejlformet svar, en gammel build der svarer
      // `null`, eller et kommando-svar i stedet for et array ville give
      // `faser` noget, `fletPomodoroInd` så `for … of` over, og hele dagens
      // tidslinje ville kaste ved rendering. Det er samme forveksling K61 fandt
      // i `useProjectClientPicker`, hvor ni vælgere læste `.map` på svaret.
      if (!Array.isArray(svar)) {
        setPomodoroFaser([]);
        setPomodoroFejl(true);
        return;
      }
      // **Dagen dømmes igen her.** `list_pomodoro_sessions` filtrerer på
      // `day = ?1`, så et svar for en anden dag kan ikke komme fra en rigtig
      // backend — men et gammelt svar der stadig er i luften, en cache, eller en
      // fejlformet række kan. Uden tjekket ville en fase fra 20/09 tegne sig i
      // linjen for 29/09, og brugeren ville tro han havde arbejdet med pomodoro
      // en dag han ikke gjorde det.
      //
      // `day` er den dag fasen **tæller på** — den den afsluttede. En fase der
      // løb 23.45–00.10 hører derfor til dagen efter midnat, selv om den startede
      // dagen før, og det er den `K61`s registrering også skriver.
      setPomodoroFaser(svar.filter((fase) => fase?.day === dag));
      setPomodoroFejl(false);
    } catch (err) {
      console.error("Failed to load pomodoro sessions:", err);
      if (pomodoroAnkommet.current !== dag) return;
      // Listen tømmes, for ellers står gårsdagens faser under dagens blokke og
      // ligner dagens. Beskeden er sin egen, så «kunne ikke hente faserne»
      // ikke forveksles med «kunne ikke hente aktiviteterne».
      setPomodoroFaser([]);
      setPomodoroFejl(true);
    }
  }, []);

  useEffect(() => {
    if (pomodoroAnkommet.current === dateStr) return;
    pomodoroAnkommet.current = dateStr;
    // Gårsdagens faser ryddes **med det samme** dagen skifter, ikke når det
    // nye svar lander. Ellers står de under den nye dags blokke indtil svaret
    // kommer, og det er præcis den forveksling nummereren over er lavet for.
    setPomodoroFaser([]);
    setPomodoroFejl(false);
  }, [dateStr]);

  // Check if AI is configured (has API key or is Ollama)
  const isAiConfigured =
    aiConfig !== null &&
    (aiConfig.api_key !== null || aiConfig.provider === "ollama");

  /**
   * Genindlæser dagen og svarer med de aktiviteter, den *faktisk* fik.
   *
   * `null` betyder «det lykkedes ikke at vide» — ikke «der er ingen
   * aktiviteter». Det er de to ting, en kaldér skal kunne skelne fra: en
   * delvis bulk-kørsl efterlader skærmen med en løgn (se `genindlæsEfterFejl`),
   * og den må ikke besvare det med et tomt valg.
   */
  const fetchData = useCallback(async (): Promise<Activity[] | null> => {
    setLoading(true);
    try {
      const [activitiesResult, projectsResult] = await Promise.all([
        tauriInvoke<Activity[]>("list_activities", { date: dateStr }),
        tauriInvoke<Project[]>("list_projects", { includeArchived: false }),
      ]);

      // Sort chronologically
      activitiesResult.sort(
        (a, b) =>
          new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
      );

      setActivities(activitiesResult);
      setProjects(projectsResult);
      setLoadFailed(false);

      // Faserne hentes **efter** aktiviteterne og i deres egen `catch`. De er
      // en tilføjelse til dagen, ikke dagen selv: en fældet database skal give
      // «kunne ikke hente pomodoro-faserne» over en brugbar tidslinje, ikke
      // tømme aktiviteterne og lade brugeren tro dagen er væk.
      void hentPomodoroFaser(dateStr);
      return activitiesResult;
    } catch (err) {
      console.error("Failed to load timeline data:", err);
      // Aktiviteterne tømmes, så en fejlet hentning for et nyt døgn ikke efterlader
      // gårsdagens blokke stående som om de var dagens. Men den tømte liste må
      // ikke vise sig som «ingen aktiviteter denne dag» — det er den besked,
      // brugeren ville tro, og den er forkert.
      setActivities([]);
      setLoadFailed(true);
      return null;
    } finally {
      setLoading(false);
    }
    // `hentPomodoroFaser` er en `useCallback` uden afhængigheder, så den er
    // stabil — den skal med, ellers ville `fetchData` bare have lukket over en
    // gammel udgave, hvis den nogensinde blev ændret.
  }, [dateStr, hentPomodoroFaser]);

  /**
   * Når en bulk-kørsl har skrevet *nogle* af aktiviteterne, står skærmen med før
   * kørslens billede: de skrevne ligner stadig uskrevne, og valget er helt. Et nyt
   * forsøg over hele valget ville så skrive dobbelt tid for de første — eller,
   * hvis brugeren ikke tænker over det, gøre det modsatte og springe over den
   * aktivitet hvis bekræftelse lykkedes mens registreringen fejlede, hvilket er
   * tabt tid.
   *
   * Derfor genindlæses dagen, så skærmen fortæller sandheden, og valget bliver
   * præcis de id'er kørslen selv rapporterede som fejlede. Kunne genindlæsningen
   * ikke, ved vi intet, og valget bliver stå — brugeren kan prøve igen.
   */
  const genindlæsEfterFejl = useCallback(
    async (fejlede?: number[]) => {
      const nye = await fetchData();
      if (!nye) return;
      // Uden en liste ved vi ikke hvad der skete, så valget bliver stå: en
      // bruger der prøver igen, skal kunne vælge alt igen.
      if (fejlede) setSelectedIds(kunFejlede(fejlede, nye));
    },
    [fetchData],
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load AI config on mount
  useEffect(() => {
    tauriInvoke<AiConfig>("get_ai_config")
      .then(setAiConfig)
      .catch(() => setAiConfig(null));
  }, []);

  // Auto-classify when date changes (once per date)
  useEffect(() => {
    if (!isAiConfigured || loading) return;
    if (hasAutoClassified.current === dateStr) return;

    // Check if there are unclassified activities
    const unclassified = activities.filter(
      (a) => !a.is_idle && !a.is_confirmed && a.project_id === null,
    );
    if (unclassified.length === 0) return;

    hasAutoClassified.current = dateStr;
    setClassifying(true);

    tauriInvoke<ClassificationResult>("classify_activities", { date: dateStr })
      .then((result) => {
        if (result.classifications.length > 0) {
          toast.info(
            t("timeline.aiClassified", {
              count: result.classifications.length,
            }),
          );
          fetchData();
        }
      })
      .catch((err) => {
        console.error("Auto-classify failed:", err);
        captureError(err, {
          feature: "ai-classification",
          action: "auto-classify",
        });
      })
      .finally(() => setClassifying(false));
  }, [dateStr, isAiConfigured, loading, activities, fetchData, t]);

  // Listen for background auto-classification events
  useEffect(() => {
    const unlisten = listen<{ count: number }>(
      "activities-classified",
      (event) => {
        const { count } = event.payload;
        toast.info(t("timeline.aiAutoClassified", { count }));
        fetchData();
      },
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchData, t]);

  // Manual classify handler
  async function handleManualClassify() {
    setClassifying(true);
    try {
      const result = await tauriInvoke<ClassificationResult>(
        "classify_activities",
        { date: dateStr },
      );
      if (result.classifications.length > 0) {
        toast.success(
          t("timeline.classified", { count: result.classifications.length }),
        );
        await fetchData();
      } else {
        toast.info(t("timeline.noActivitiesToClassify"));
      }
    } catch (err) {
      // Uden internet kom Rust's egen kæde af årsager: "OpenAI
      // forbindelsesfejl: error sending request for url (...)". Den siger
      // intet om, hvad brugeren kan gøre, så en netværksfejl bliver den
      // oversatte sætning.
      const message = isNetworkError(err)
        ? getOfflineMessage("ai")
        : typeof err === "string"
          ? err
          : t("timeline.classificationFailed");
      toast.error(message);
      captureError(err, {
        feature: "ai-classification",
        action: "manual-classify",
      });
    } finally {
      setClassifying(false);
    }
  }

  function goToPreviousDay() {
    setSelectedDate((prev) => shiftDay(prev, -1));
  }

  function goToNextDay() {
    setSelectedDate((prev) => shiftDay(prev, 1));
  }

  function goToToday() {
    setSelectedDate(new Date());
  }

  function handleConfirmActivity(activity: Activity) {
    setConfirmActivity(activity);
  }

  function handleCreateRule(activity: Activity) {
    setRuleInitial(buildRuleInitialFromActivity(activity));
    setRuleDialogOpen(true);
  }

  function handleConfirmDialogClose() {
    setConfirmActivity(null);
  }

  function handleConfirmed() {
    setConfirmActivity(null);
    fetchData();
  }

  // Bulk confirm all high-confidence activities
  async function handleBulkConfirm() {
    const highConfidence = activities.filter(
      (a) =>
        !a.is_idle &&
        !a.is_confirmed &&
        a.confidence !== null &&
        a.confidence > 0.85,
    );

    if (highConfidence.length === 0) return;

    setBulkConfirming(true);
    try {
      // The run holds its own lock, so a double click cannot register every
      // activity a second time.
      const { kørte, fejlede } = await bulkConfirmActivities(
        highConfidence,
        projects,
      );
      if (!kørte) return;
      if (fejlede.length > 0) {
        toast.error(t("timeline.couldNotConfirmAll"));
        await genindlæsEfterFejl(fejlede);
        return;
      }
      toast.success(
        t("timeline.activitiesConfirmed", { count: highConfidence.length }),
      );
      await fetchData();
    } catch (err) {
      console.error("Bulk confirm failed:", err);
      toast.error(t("timeline.couldNotConfirmAll"));
      await genindlæsEfterFejl();
    } finally {
      setBulkConfirming(false);
    }
  }

  // Confirm every member of a merged block via the same pipeline
  async function handleConfirmBlock(block: MergedActivityBlock) {
    const renderKey = `${block.key}:${block.activityIds[0]}`;
    setConfirmingBlockKey(renderKey);
    try {
      const { kørte, fejlede } = await bulkConfirmActivities(
        block.activities,
        projects,
      );
      if (!kørte) return;
      if (fejlede.length > 0) {
        toast.error(t("timeline.couldNotConfirmAll"));
        await genindlæsEfterFejl(fejlede);
        return;
      }
      toast.success(
        t("timeline.activitiesConfirmed", { count: block.activities.length }),
      );
      await fetchData();
    } catch (err) {
      console.error("Block confirm failed:", err);
      toast.error(t("timeline.couldNotConfirmAll"));
      await genindlæsEfterFejl();
    } finally {
      setConfirmingBlockKey(null);
    }
  }

  // --- Bulk operations ---

  function toggleBulkMode() {
    if (bulkMode) {
      setBulkMode(false);
      setSelectedIds(new Set());
    } else {
      setBulkMode(true);
    }
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function selectAll() {
    const allNonIdle = activities.filter((a) => !a.is_idle).map((a) => a.id);
    setSelectedIds(new Set(allNonIdle));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  async function handleBulkAssignProject(projectId: string) {
    setBulkProcessing(true);
    setBulkAssignDropdownOpen(false);
    try {
      const count = selectedIds.size;
      // The operation holds its own lock, so a second click cannot register the
      // same activities twice — the costliest bug this screen can produce.
      const { kørte, fejlede } = await bulkAssignProject(
        selectedIds,
        activities,
        projects,
        projectId,
      );
      if (!kørte) return;
      if (fejlede.length > 0) {
        // Kun de fejlede bliver liggende, så et nyt forsøg skriver dem og ingen
        // andre. Tælleren er dem, der faktisk fejlede — ikke hele valget.
        toast.error(
          t("timeline.bulkAssignedSome", {
            done: selectedIds.size - fejlede.length,
            total: selectedIds.size,
          }),
        );
        await genindlæsEfterFejl(fejlede);
        return;
      }

      toast.success(t("timeline.bulkAssigned", { count }));
      setSelectedIds(new Set());
      setBulkAssignOpen(false);
      await fetchData();
    } catch (err) {
      console.error("Bulk assign failed:", err);
      toast.error(t("timeline.bulkAssignFailed"));
      await genindlæsEfterFejl();
    } finally {
      setBulkProcessing(false);
    }
  }

  async function handleBulkDelete() {
    setBulkProcessing(true);
    try {
      const count = selectedIds.size;
      const { kørte, fejlede } = await bulkDelete(selectedIds);
      if (!kørte) return;
      if (fejlede.length > 0) {
        toast.error(t("timeline.bulkDeleteFailed"));
        await genindlæsEfterFejl(fejlede);
        return;
      }

      toast.success(t("timeline.bulkDeleted", { count }));
      setSelectedIds(new Set());
      setBulkDeleteConfirmOpen(false);
      await fetchData();
    } catch (err) {
      console.error("Bulk delete failed:", err);
      toast.error(t("timeline.bulkDeleteFailed"));
      await genindlæsEfterFejl();
    } finally {
      setBulkProcessing(false);
    }
  }

  async function handleBulkMarkNonBillable() {
    setBulkProcessing(true);
    try {
      const count = selectedIds.size;
      const { kørte, fejlede } = await bulkMarkNonBillable(
        selectedIds,
        activities,
      );
      if (!kørte) return;
      if (fejlede.length > 0) {
        toast.error(t("timeline.bulkMarkFailed"));
        await genindlæsEfterFejl(fejlede);
        return;
      }

      toast.success(t("timeline.bulkMarkedNonBillable", { count }));
      setSelectedIds(new Set());
      await fetchData();
    } catch (err) {
      console.error("Bulk mark non-billable failed:", err);
      toast.error(t("timeline.bulkMarkFailed"));
      await genindlæsEfterFejl();
    } finally {
      setBulkProcessing(false);
    }
  }

  // --- Keyboard navigation ---
  const rowRefs = useRef(new Map<number, HTMLDivElement>());

  const keyboard = useListKeyboard({
    itemCount: nonIdleActivities.length,
    enabled:
      !bulkMode &&
      !confirmActivity &&
      !deleteActivity &&
      !bulkAssignOpen &&
      !bulkDeleteConfirmOpen,
    onSelect: (index) => {
      const activity = nonIdleActivities[index];
      if (activity) handleConfirmActivity(activity);
    },
    onApprove: (index) => {
      const activity = nonIdleActivities[index];
      if (activity) handleConfirmActivity(activity);
    },
    onDelete: (index) => {
      const activity = nonIdleActivities[index];
      if (activity) setDeleteActivity(activity);
    },
    onHorizontal: (delta) => {
      setSelectedDate((prev) => shiftDay(prev, delta));
    },
  });

  const activeActivity =
    keyboard.activeIndex >= 0
      ? nonIdleActivities[keyboard.activeIndex]
      : undefined;

  // Another day has its own rows, so the cursor is dropped when the date
  // changes — a stale index would point at a different activity entirely.
  const { setActiveIndex } = keyboard;
  const shownDateStr = useRef(dateStr);
  useEffect(() => {
    if (shownDateStr.current === dateStr) return;
    shownDateStr.current = dateStr;
    setActiveIndex(-1);
  }, [dateStr, setActiveIndex]);

  // Keep the cursor row on screen — a busy day is taller than the window, and
  // without this the highlight silently walks off the bottom of the list.
  useEffect(() => {
    if (!activeActivity) return;
    rowRefs.current
      .get(activeActivity.id)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeActivity]);

  function performDeleteActivity(activity: Activity) {
    tauriInvoke("delete_activity", { activityId: activity.id })
      .then(() => {
        toast.success(t("timeline.activityDeleted"));
        fetchData();
      })
      .catch((err) => {
        console.error("Failed to delete activity:", err);
        toast.error(t("timeline.couldNotDelete"));
      })
      .finally(() => setDeleteActivity(null));
  }

  // Count activities eligible for bulk confirm
  const bulkConfirmCount = activities.filter(
    (a) =>
      !a.is_idle &&
      !a.is_confirmed &&
      a.confidence !== null &&
      a.confidence > 0.85,
  ).length;

  // Max duration for bar sizing
  const maxDuration = Math.max(
    ...activities.filter((a) => !a.is_idle).map((a) => a.duration),
    1,
  );

  // Track non-idle index for highlighting
  let nonIdleIndex = -1;

  // One activity row — identical for flat and block-member rendering, so
  // every existing action (confirm, edit, delete, bulk select) is preserved.
  function renderActivityRow(activity: Activity) {
    // Track non-idle index for keyboard highlight
    const currentNonIdleIndex = activity.is_idle ? -1 : ++nonIdleIndex;
    const isKeyboardActive =
      !bulkMode &&
      currentNonIdleIndex >= 0 &&
      currentNonIdleIndex === keyboard.activeIndex;

    return (
      <div
        key={activity.id}
        ref={(el) => {
          if (el) rowRefs.current.set(activity.id, el);
          else rowRefs.current.delete(activity.id);
        }}
        className={`scroll-mt-2 flex items-center gap-2 ${
          isKeyboardActive
            ? "rounded-lg bg-(--color-border)/30 ring-2 ring-(--color-accent)"
            : ""
        }`}
      >
        {/* Checkbox in bulk mode */}
        {bulkMode && !activity.is_idle && (
          <button
            type="button"
            onClick={() => toggleSelected(activity.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-(--color-border) transition-colors hover:border-(--color-accent)"
          >
            {selectedIds.has(activity.id) && (
              <div className="h-3 w-3 rounded-sm bg-(--color-accent)" />
            )}
          </button>
        )}
        <div className="flex-1">
          <ActivityBlock
            activity={activity}
            projects={projects}
            onConfirm={handleConfirmActivity}
            onCreateRule={handleCreateRule}
            maxDuration={maxDuration}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-(--color-text)">
            {t("timeline.title")}
          </h1>
          <p className="mt-1 text-sm text-(--color-text-muted)">
            {t("timeline.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Bulk mode toggle */}
          <Button
            size="sm"
            variant={bulkMode ? "primary" : "ghost"}
            onClick={toggleBulkMode}
            className="gap-1.5"
          >
            {bulkMode ? <CheckSquare size={14} /> : <Square size={14} />}
            {t("timeline.selectMultiple")}
          </Button>

          {/* Classify with AI button */}
          <Button
            size="sm"
            variant="secondary"
            onClick={handleManualClassify}
            disabled={classifying || !isAiConfigured}
            title={
              isAiConfigured
                ? t("timeline.classifyWithAi")
                : `${t("timeline.aiNotConfigured")} — ${t("timeline.setupInSettings")}`
            }
            className="gap-1.5"
          >
            {classifying ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {classifying
              ? t("timeline.classifying")
              : t("timeline.classifyWithAi")}
          </Button>

          {bulkConfirmCount > 0 && (
            <Button
              size="sm"
              onClick={handleBulkConfirm}
              disabled={bulkConfirming}
              className="gap-1.5"
            >
              <CheckCheck size={14} />
              {bulkConfirming
                ? t("timeline.confirming")
                : t("timeline.confirmAll", { count: bulkConfirmCount })}
            </Button>
          )}
        </div>
      </div>

      {/* AI status indicator */}
      <div className="flex items-center gap-2 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-xs text-(--color-text-muted)">
        <Sparkles size={12} />
        {isAiConfigured ? (
          <span>
            {t("timeline.aiConfigured")}:{" "}
            <span className="font-medium text-(--color-text)">
              {aiConfig?.provider === "openai"
                ? "OpenAI"
                : aiConfig?.provider === "anthropic"
                  ? "Claude"
                  : aiConfig?.provider === "google"
                    ? "Google Gemini"
                    : aiConfig?.provider === "ollama"
                      ? "Ollama"
                      : aiConfig?.provider === "openrouter"
                        ? "OpenRouter"
                        : aiConfig?.provider === "ordbogen"
                          ? "Ordbogen.ai"
                          : aiConfig?.provider}
            </span>
            {aiConfig?.model && (
              <span className="text-(--color-text-muted)">
                {" "}
                ({aiConfig.model})
              </span>
            )}
          </span>
        ) : (
          <span>
            {t("timeline.aiNotConfigured")} —{" "}
            <button
              type="button"
              onClick={() =>
                navigate({
                  to: "/settings",
                  search: { tab: "ai" } as never,
                })
              }
              className="inline-flex items-center gap-1 font-medium text-(--color-accent) hover:underline"
            >
              <Settings size={10} />
              {t("timeline.setupInSettings")}
            </button>
          </span>
        )}
        {classifying && (
          <span className="ml-auto flex items-center gap-1 text-(--color-accent)">
            <Loader2 size={10} className="animate-spin" />
            {t("timeline.classifying")}
          </span>
        )}
      </div>

      {/* Precision tip: nudge to enable opt-in browser URL capture */}
      <BrowserUrlHint />

      {/* Date navigator */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={goToPreviousDay}
          className="flex h-8 w-8 items-center justify-center rounded-md text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text)"
          aria-label={t("timeline.previousDay")}
          title={t("timeline.previousDay")}
        >
          <ChevronLeft size={16} />
        </button>

        <div className="flex items-center gap-2 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-1.5">
          <CalendarDays size={14} className="text-(--color-text-muted)" />
          <span className="text-sm font-medium text-(--color-text)">
            {isToday
              ? t("common.today")
              : formatDate(selectedDate.toISOString())}
          </span>
          {isToday && (
            <span className="text-xs text-(--color-text-muted)">
              &mdash; {formatDate(selectedDate.toISOString())}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={goToNextDay}
          className="flex h-8 w-8 items-center justify-center rounded-md text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text)"
          aria-label={t("timeline.nextDay")}
          title={t("timeline.nextDay")}
        >
          <ChevronRight size={16} />
        </button>

        {!isToday && (
          <button
            type="button"
            onClick={goToToday}
            className="ml-1 rounded-md bg-(--color-border)/50 px-2.5 py-1 text-xs font-medium text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text)"
          >
            {t("common.today")}
          </button>
        )}

        {/* Select all / deselect all when in bulk mode */}
        {bulkMode && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={selectAll}
              className="rounded-md px-2 py-1 text-xs text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text)"
            >
              {t("timeline.selectAll")}
            </button>
            <button
              type="button"
              onClick={deselectAll}
              className="rounded-md px-2 py-1 text-xs text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text)"
            >
              {t("timeline.deselectAll")}
            </button>
          </div>
        )}
      </div>

      {/* Activities list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-(--color-border) border-t-(--color-accent)" />
        </div>
      ) : loadFailed ? (
        <LoadError
          message={t("timeline.loadFailed")}
          onRetry={() => {
            setLoading(true);
            fetchData();
          }}
        />
      ) : activities.length === 0 && pomodoroFaser.length === 0 ? (
        // Tom-tilstanden dømmes på **begge** slags data. Trackeren kan være slået
        // fra mens brugeren kører pomodoros, og en dag med tre gennemførte
        // pomodoros og ingen registreret tid er ikke en tom dag — den er en dag
        // med faser, som står under «Ingen aktiviteter registreret i dag».
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-(--color-border) py-16">
          <Clock size={32} className="text-(--color-text-muted)/30" />
          <p className="text-sm text-(--color-text-muted)">
            {isToday
              ? t("timeline.noActivitiesToday")
              : t("timeline.noActivitiesThisDay")}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {pomodoroFejl && (
            <p
              role="status"
              className="px-1 pb-1 text-xs text-(--color-text-muted)"
            >
              {t("timeline.pomodoroPhasesFailed")}
            </p>
          )}
          <AnimatePresence mode="popLayout">
            {tidslinjeRækker.map((række) => {
              // En pomodoro-fase er en visning, ikke en aktivitet: den har ingen
              // app at klassificere og intet at bekræfte, så den får sin egen
              // række frem for at gå gennem `renderActivityRow`.
              if (række.slags === "fase") {
                return (
                  <PomodoroFaseRække
                    key={`pomodoro:${række.fase.id}`}
                    fase={række.fase}
                  />
                );
              }

              const block = række.blok;

              // Only unconfirmed, non-idle multi-member blocks get a header.
              // Confirmed/idle activities and single-member blocks render
              // exactly as flat rows.
              const isGrouped =
                block.activities.length > 1 &&
                block.activities.every((a) => !a.is_idle && !a.is_confirmed);

              if (!isGrouped) {
                return block.activities.map((activity) =>
                  renderActivityRow(activity),
                );
              }

              const renderKey = `${block.key}:${block.activityIds[0]}`;
              const blockProject = block.projectId
                ? projects.find((p) => p.id === block.projectId)
                : undefined;
              const isConfirmingBlock = confirmingBlockKey === renderKey;

              return (
                <div key={renderKey} className="space-y-1.5">
                  {/* Block header */}
                  <div className="flex items-center gap-3 rounded-lg bg-(--color-border)/20 px-3 py-1.5">
                    <span className="shrink-0 font-mono text-xs text-(--color-text-muted)">
                      {formatTime(block.startedAt)}&ndash;
                      {formatTime(block.endedAt)}
                    </span>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {blockProject?.color && (
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: blockProject.color }}
                        />
                      )}
                      <span className="truncate text-xs font-medium text-(--color-text)">
                        {blockProject?.name ?? block.appName}
                      </span>
                      {block.dominantTitle && (
                        <span className="truncate text-xs text-(--color-text-muted)">
                          {block.dominantTitle}
                        </span>
                      )}
                      <span className="shrink-0 rounded bg-(--color-border)/60 px-1.5 py-px text-[10px] text-(--color-text-muted)">
                        {t("timeline.blockActivityCount", {
                          count: block.activities.length,
                        })}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-xs font-medium text-(--color-text)">
                      {formatDuration(block.totalDuration)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleConfirmBlock(block)}
                      disabled={confirmingBlockKey !== null || bulkConfirming}
                      className="shrink-0 gap-1"
                    >
                      {isConfirmingBlock ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <CheckCheck size={12} />
                      )}
                      {t("timeline.blockConfirmAll", {
                        count: block.activities.length,
                      })}
                    </Button>
                  </div>
                  {/* Member rows, indented under the header */}
                  <div className="ml-2 space-y-1.5 border-l-2 border-(--color-border)/60 pl-3">
                    {block.activities.map((activity) =>
                      renderActivityRow(activity),
                    )}
                  </div>
                </div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Screen readers get told where the keyboard cursor is — the ring is
          invisible to them, so j/k used to move in silence. */}
      <p aria-live="polite" className="sr-only">
        {activeActivity
          ? activeActivityAnnouncement(
              activeActivity,
              keyboard.activeIndex + 1,
              nonIdleActivities.length,
              t,
            )
          : ""}
      </p>

      {/* Keyboard hint (only when not in bulk mode) */}
      {!bulkMode && !loading && nonIdleActivities.length > 0 && (
        <p className="text-center text-[10px] text-(--color-text-muted)/50">
          {t("timeline.keyboardHint")}
        </p>
      )}

      {/* Day summary */}
      {!loading && activities.length > 0 && (
        <DaySummary activities={activities} projects={projects} />
      )}

      {/* Bulk action bar */}
      <AnimatePresence>
        {bulkMode && selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-(--color-border) bg-(--color-surface) px-4 py-2.5 shadow-2xl"
          >
            <span className="mr-2 text-xs font-medium text-(--color-text)">
              {t("timeline.bulkSelected", { count: selectedIds.size })}
            </span>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setBulkAssignOpen(true)}
              disabled={bulkProcessing}
              className="gap-1.5"
            >
              {t("timeline.bulkAssignProject")}
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={handleBulkMarkNonBillable}
              disabled={bulkProcessing}
              className="gap-1.5"
            >
              {t("timeline.bulkMarkNonBillable")}
            </Button>

            <Button
              size="sm"
              variant="danger"
              onClick={() => setBulkDeleteConfirmOpen(true)}
              disabled={bulkProcessing}
              className="gap-1.5"
            >
              <Trash2 size={13} />
              {t("common.delete")}
            </Button>

            <button
              type="button"
              onClick={() => {
                setBulkMode(false);
                setSelectedIds(new Set());
              }}
              className="ml-1 flex h-6 w-6 items-center justify-center rounded-md text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text)"
              title={t("common.cancel")}
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bulk assign project dialog */}
      <Dialog
        open={bulkAssignOpen}
        onClose={() => {
          setBulkAssignOpen(false);
          setBulkAssignDropdownOpen(false);
        }}
        title={t("timeline.bulkAssignProject")}
      >
        <div className="space-y-3">
          <p className="text-xs text-(--color-text-muted)">
            {t("timeline.bulkAssignDesc", { count: selectedIds.size })}
          </p>

          <div className="relative">
            <button
              type="button"
              onClick={() => setBulkAssignDropdownOpen(!bulkAssignDropdownOpen)}
              className="flex h-9 w-full items-center justify-between rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm transition-colors hover:border-(--color-text-muted)"
            >
              <span className="text-(--color-text-muted)">
                {t("common.selectProject")}
              </span>
              <ChevronDown
                size={14}
                className={`text-(--color-text-muted) transition-transform ${bulkAssignDropdownOpen ? "rotate-180" : ""}`}
              />
            </button>

            {bulkAssignDropdownOpen && (
              <div className="absolute top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface) py-1 shadow-lg">
                {projects
                  .filter((p) => !p.is_archived)
                  .map((project) => (
                    <button
                      type="button"
                      key={project.id}
                      onClick={() => handleBulkAssignProject(project.id)}
                      disabled={bulkProcessing}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-(--color-border)"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: project.color ?? "#6b7280",
                        }}
                      />
                      <span className="text-(--color-text)">
                        {project.name}
                      </span>
                      {project.client_name && (
                        <span className="text-xs text-(--color-text-muted)">
                          ({project.client_name})
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      </Dialog>

      {/* Bulk delete confirm dialog */}
      <Dialog
        open={bulkDeleteConfirmOpen}
        onClose={() => setBulkDeleteConfirmOpen(false)}
        title={t("timeline.bulkDeleteConfirm")}
        footer={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBulkDeleteConfirmOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleBulkDelete}
              disabled={bulkProcessing}
            >
              {bulkProcessing
                ? t("common.deleting")
                : t("timeline.bulkDeleteConfirmBtn", {
                    count: selectedIds.size,
                  })}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-(--color-text-muted)">
          {t("timeline.bulkDeleteWarning", { count: selectedIds.size })}
        </p>
      </Dialog>

      {/* Single activity delete confirm dialog */}
      <Dialog
        open={deleteActivity !== null}
        onClose={() => setDeleteActivity(null)}
        title={t("timeline.deleteActivityConfirm")}
        footer={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDeleteActivity(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (deleteActivity) performDeleteActivity(deleteActivity);
              }}
            >
              {t("common.delete")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-(--color-text-muted)">
          {t("timeline.deleteActivityWarning")}
        </p>
      </Dialog>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={confirmActivity !== null}
        onClose={handleConfirmDialogClose}
        onConfirmed={handleConfirmed}
        activity={confirmActivity}
        projects={projects}
      />

      {/* Create rule from activity dialog */}
      <RuleDialog
        open={ruleDialogOpen}
        onClose={() => setRuleDialogOpen(false)}
        onSaved={() => {
          setRuleDialogOpen(false);
          fetchData();
        }}
        projects={projects}
        initialForm={ruleInitial}
      />
    </div>
  );
}
