/**
 * Kanban-kolonner (task_statuses) er brugerdefinerede, men hver kolonne
 * hører til én af fire faste kategorier. Kategorien styrer den gamle
 * `tasks.status`-værdi, som rapporter, filtre, desktop-appen og API'et
 * stadig læser, så en omdøbt eller ny kolonne ikke ændrer, hvad
 * "afsluttet" betyder.
 *
 * Rene funktioner: bruges både af routerne og af tavlen i browseren.
 */

export const LANE_CATEGORIES = [
  "not_started",
  "in_progress",
  "done",
  "cancelled",
] as const;

export type LaneCategory = (typeof LANE_CATEGORIES)[number];

export const LANE_CATEGORY_LABELS: Record<LaneCategory, string> = {
  not_started: "Ikke startet",
  in_progress: "I gang",
  done: "Afsluttet",
  cancelled: "Annulleret",
};

export type LegacyTaskStatus = "backlog" | "todo" | "in_progress" | "done";

export function isLaneCategory(value: unknown): value is LaneCategory {
  return (
    typeof value === "string" &&
    (LANE_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Afsluttede og annullerede opgaver tæller ikke som aktive. */
export function isClosedCategory(category: LaneCategory): boolean {
  return category === "done" || category === "cancelled";
}

export function categoryForLegacyStatus(status: string): LaneCategory {
  switch (status) {
    case "in_progress":
      return "in_progress";
    case "done":
      return "done";
    default:
      return "not_started";
  }
}

/** Standardkolonnernes navne bevarer deres egen gamle status. */
const LEGACY_STATUS_BY_LANE_NAME: Record<string, LegacyTaskStatus> = {
  Backlog: "backlog",
  Todo: "todo",
  "I gang": "in_progress",
  Afsluttet: "done",
};

/**
 * Den gamle status, en opgave skal have i kolonnen. "Ikke startet" har to
 * gamle værdier (backlog og todo): standardkolonnerne beholder deres egen,
 * og egne kolonner bevarer opgavens nuværende, hvis den allerede er en af
 * dem. Annulleret skrives som done, fordi den gamle status er lukket
 * (backlog, todo, in_progress, done) og læses af klienter, vi ikke styrer.
 */
export function legacyStatusForLane(
  lane: { name: string; category: LaneCategory },
  current: string,
): LegacyTaskStatus {
  const byName = LEGACY_STATUS_BY_LANE_NAME[lane.name];
  if (byName && categoryForLegacyStatus(byName) === lane.category) {
    return byName;
  }
  switch (lane.category) {
    case "in_progress":
      return "in_progress";
    case "done":
    case "cancelled":
      return "done";
    default:
      return current === "backlog" || current === "todo" ? current : "todo";
  }
}

/**
 * Er opgaven afsluttet (ikke annulleret)? Den gamle status er "done" for
 * begge, så kolonnens kategori afgør det: done i en annulleret kolonne er
 * en annullering, ikke en gennemført opgave.
 */
export function isCompletedTask(
  status: string,
  laneCategory: LaneCategory | null | undefined,
): boolean {
  return status === "done" && laneCategory !== "cancelled";
}

/**
 * completedAt følger overgangen ind i og ud af "afsluttet": sættes, når en
 * opgave afsluttes, ryddes, når den genåbnes eller annulleres, og røres
 * ellers ikke.
 */
export function completedAtChange(
  wasCompleted: boolean,
  isCompleted: boolean,
  now: Date,
): { completedAt: Date | null } | Record<string, never> {
  if (isCompleted && !wasCompleted) return { completedAt: now };
  if (!isCompleted && wasCompleted) return { completedAt: null };
  return {};
}

/** Passer opgavens gamle status med kolonnens kategori? */
export function laneMatchesLegacyStatus(
  category: LaneCategory,
  status: string,
): boolean {
  const wanted = categoryForLegacyStatus(status);
  if (wanted === "done") return isClosedCategory(category);
  return category === wanted;
}

export interface LaneForResolve {
  id: string;
  name: string;
  category: LaneCategory;
  order: number;
}

/**
 * Hvilken kolonne på tavlen en opgave står i.
 *
 * `statusId` vinder, når kolonnen findes på tavlen og passer med den gamle
 * status. Ellers er status ændret et andet sted (desktop, API, listen,
 * mail-til-opgave), eller kolonnen hører til et andet board; så vælges
 * standardkolonnen med samme navn, derefter den første kolonne i samme
 * kategori. Findes ingen kolonne i kategorien, bliver opgaven i sin egen
 * kolonne eller lander i den første, så den aldrig forsvinder fra tavlen.
 */
export function resolveTaskLaneId(
  task: { statusId: string | null; status: string },
  lanes: readonly LaneForResolve[],
): string | null {
  if (lanes.length === 0) return null;
  const ordered = [...lanes].sort((a, b) => a.order - b.order);
  const current = task.statusId
    ? ordered.find((l) => l.id === task.statusId)
    : undefined;
  if (current && laneMatchesLegacyStatus(current.category, task.status)) {
    return current.id;
  }
  const byName = ordered.find(
    (l) =>
      LEGACY_STATUS_BY_LANE_NAME[l.name] === task.status &&
      laneMatchesLegacyStatus(l.category, task.status),
  );
  if (byName) return byName.id;
  const wanted = categoryForLegacyStatus(task.status);
  const byCategory =
    ordered.find((l) => l.category === wanted) ??
    ordered.find((l) => laneMatchesLegacyStatus(l.category, task.status));
  if (byCategory) return byCategory.id;
  return current?.id ?? ordered[0].id;
}

/**
 * Kolonnen, opgaveformularens status-vælger starter i: opgavens kolonne,
 * når den rettes, ellers den kolonne, tavlens "+" kom fra (id), eller den
 * første kolonne, der passer med en gammel status.
 */
export function formLaneId(
  lanes: readonly LaneForResolve[],
  task: { statusId?: string | null; status: string } | null | undefined,
  defaultStatus?: string,
): string | null {
  if (task) {
    return resolveTaskLaneId(
      { statusId: task.statusId ?? null, status: task.status },
      lanes,
    );
  }
  if (defaultStatus && lanes.some((l) => l.id === defaultStatus)) {
    return defaultStatus;
  }
  return resolveTaskLaneId(
    { statusId: null, status: defaultStatus ?? "todo" },
    lanes,
  );
}

/** Flyt ét element én plads op (-1) eller ned (+1). Uændret ved kanten. */
export function moveItem<T>(items: readonly T[], index: number, delta: -1 | 1) {
  const target = index + delta;
  if (index < 0 || index >= items.length) return [...items];
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * Kolonnens rækkefølge efter at `taskId` er sluppet på `index` (0 = øverst).
 * `ids` er kolonnens opgaver i nuværende rækkefølge og må indeholde
 * `taskId` (flyt inden for kolonnen) eller ej (flyt hertil fra en anden).
 */
export function insertAt(
  ids: readonly string[],
  taskId: string,
  index: number,
): string[] {
  const rest = ids.filter((id) => id !== taskId);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), taskId, ...rest.slice(at)];
}

export type BoardSort = "manual" | "deadline" | "priority" | "client";

export const BOARD_SORT_LABELS: Record<BoardSort, string> = {
  manual: "Manuel",
  deadline: "Deadline",
  priority: "Prioritet",
  client: "Kunde",
};

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

interface SortableTask {
  position?: number | null;
  deadline?: Date | string | null;
  priority?: string | null;
  client?: { name: string } | null;
}

/**
 * Kortenes rækkefølge i en kolonne. "Manuel" er den gemte rækkefølge
 * (serveren leverer kortene sorteret på position); de andre er stabile
 * visninger oven på den, så ens kort beholder deres manuelle orden.
 */
export function sortLaneTasks<T extends SortableTask>(
  tasks: readonly T[],
  sort: BoardSort,
): T[] {
  if (sort === "manual") return [...tasks];
  const keyed = tasks.map((task, i) => ({ task, i }));
  const time = (d: Date | string | null | undefined) =>
    d ? new Date(d).getTime() : Number.POSITIVE_INFINITY;
  keyed.sort((a, b) => {
    let diff = 0;
    if (sort === "deadline") {
      diff = time(a.task.deadline) - time(b.task.deadline);
    } else if (sort === "priority") {
      diff =
        (PRIORITY_RANK[a.task.priority ?? "medium"] ?? 2) -
        (PRIORITY_RANK[b.task.priority ?? "medium"] ?? 2);
    } else {
      const an = a.task.client?.name;
      const bn = b.task.client?.name;
      if (an && bn) diff = an.localeCompare(bn, "da");
      else if (an) diff = -1;
      else if (bn) diff = 1;
    }
    if (Number.isNaN(diff)) diff = 0;
    return diff !== 0 ? diff : a.i - b.i;
  });
  return keyed.map((k) => k.task);
}
