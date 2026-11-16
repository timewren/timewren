import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { syncT } from "@/i18n/sync-text";
import * as schema from "@/lib/db/schema";
import { descriptionToNote } from "./timesheet-validation";

/**
 * Aktivitetstyper (#459) — dimension på tidsregistreringer pr. org.
 * kunde C tænker i aktiviteter under et projekt (undervisning/forberedelse/
 * møder/administration); ugegrid'ets nøgle er (projekt, aktivitet, dag).
 * Rene helpers her, så rækkeopbygning og standarder kan testes uden DB.
 */

export type DefaultActivityType = {
  name: string;
  color: string;
  isDefault: boolean;
  sortOrder: number;
};

export const DEFAULT_ACTIVITY_TYPES: readonly DefaultActivityType[] = [
  { name: "Undervisning", color: "#3b82f6", isDefault: true, sortOrder: 0 },
  { name: "Forberedelse", color: "#10b981", isDefault: false, sortOrder: 1 },
  { name: "Møder", color: "#f59e0b", isDefault: false, sortOrder: 2 },
  { name: "Administration", color: "#8b5cf6", isDefault: false, sortOrder: 3 },
  { name: "Andet", color: "#6b7280", isDefault: false, sortOrder: 4 },
];

/**
 * Hvilke standardtyper mangler, givet org'ens eksisterende (inkl.
 * arkiverede). Matcher på navn, case-insensitivt. isDefault sættes kun hvis
 * org'en ikke allerede har en default. sortOrder lægges efter de eksisterende.
 */
export function planDefaultActivityTypes(
  existing: ReadonlyArray<{
    name: string;
    isDefault: boolean;
    sortOrder: number;
  }>,
): DefaultActivityType[] {
  const names = new Set(existing.map((t) => t.name.trim().toLowerCase()));
  const hasDefault = existing.some((t) => t.isDefault);
  const base =
    existing.length > 0 ? Math.max(...existing.map((t) => t.sortOrder)) + 1 : 0;
  return DEFAULT_ACTIVITY_TYPES.filter(
    (t) => !names.has(t.name.toLowerCase()),
  ).map((t, i) => ({
    ...t,
    isDefault: t.isDefault && !hasDefault,
    sortOrder: base + i,
  }));
}

/**
 * Opret de standardtyper org'en mangler. Idempotent (matcher også
 * arkiverede, så en bevidst fjernet type ikke dukker op igen). Returnerer
 * navnene på de oprettede typer.
 */
export async function ensureDefaultActivityTypes(
  db: PostgresJsDatabase<typeof schema>,
  orgId: string,
): Promise<string[]> {
  const existing = await db.query.activityTypes.findMany({
    where: eq(schema.activityTypes.organizationId, orgId),
    columns: { name: true, isDefault: true, sortOrder: true },
  });
  const missing = planDefaultActivityTypes(existing);
  if (missing.length === 0) return [];

  await db.insert(schema.activityTypes).values(
    missing.map((t) => ({
      organizationId: orgId,
      name: t.name,
      color: t.color,
      isDefault: t.isDefault,
      sortOrder: t.sortOrder,
    })),
  );
  return missing.map((t) => t.name);
}

// ---------------------------------------------------------------------------
// Ugegrid: rækker pr. (projekt, aktivitet)
// ---------------------------------------------------------------------------

export type TimesheetDayCell = {
  total: number;
  timesheetHours: number;
  /** Cellenote (#467) fra grid-postens description; null = ingen note */
  note: string | null;
};
export type TimesheetRowSource = "entries" | "assigned" | "all" | "manual";

export type TimesheetRow = {
  projectId: string | null;
  projectName: string;
  /** null = uden aktivitet (legacy-poster, eller org uden aktivitetstyper) */
  activityTypeId: string | null;
  activityName: string | null;
  activityColor: string | null;
  source: TimesheetRowSource;
  hidden: boolean;
  days: Record<string, TimesheetDayCell>;
};

export type GridActivityType = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  isArchived: boolean;
};

export type GridEntry = {
  projectId: string | null;
  projectName: string | null;
  activityTypeId: string | null;
  /** YYYY-MM-DD (lokal dato) */
  date: string;
  hours: number;
  source: string | null;
  /** time_entries.description — kun grid-poster (source=timesheet) giver note */
  description?: string | null;
};

export const TIMESHEET_SOURCE = "timesheet";

/** Stabil rækkenøgle (projekt, aktivitet). */
export function timesheetRowKey(
  projectId: string | null,
  activityTypeId: string | null,
): string {
  return `${projectId ?? "none"}|${activityTypeId ?? ""}`;
}

/**
 * Aktiviteter et projekt må registreres på: projektets tilladte liste, ellers
 * (tom liste) alle org'ens aktive aktivitetstyper. Arkiverede typer indgår
 * aldrig som standardrækker — kun via poster der allerede findes.
 */
export function allowedActivitiesForProject(
  projectId: string,
  activityTypes: readonly GridActivityType[],
  allowedByProject: ReadonlyMap<string, ReadonlySet<string>>,
): GridActivityType[] {
  const active = activityTypes.filter((t) => !t.isArchived);
  const allowed = allowedByProject.get(projectId);
  if (!allowed || allowed.size === 0) return sortActivities(active);
  return sortActivities(active.filter((t) => allowed.has(t.id)));
}

function sortActivities<T extends { name: string; sortOrder: number }>(
  types: T[],
): T[] {
  return [...types].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "da"),
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Byg grid'ets rækker for én uge.
 *
 * - Uden aktivitetstyper i org'en: præcis én række pr. projekt (som før #459).
 * - Med aktivitetstyper: pr. projekt én række pr. tilladt aktivitet ∪
 *   aktiviteter med poster i ugen. Poster uden aktivitet (legacy) får en
 *   "(uden aktivitet)"-række sidst under projektet, som stadig kan redigeres.
 * - Faste rækker (tildelte ∪ availableToAll) vises også uden poster, med
 *   mindre brugeren har skjult projektet (→ hiddenProjects).
 * - Poster uden projekt samles i én read-only syncT("common.noProject")-række.
 *
 * Sortering: projektnavn, derefter aktivitetens sortOrder/navn, legacy sidst.
 */
export function buildTimesheetRows(params: {
  entries: readonly GridEntry[];
  days: readonly string[];
  orgProjects: ReadonlyArray<{
    id: string;
    name: string;
    availableToAll: boolean | null;
  }>;
  assignedProjectIds: ReadonlySet<string>;
  hiddenProjectIds: ReadonlySet<string>;
  activityTypes: readonly GridActivityType[];
  allowedByProject: ReadonlyMap<string, ReadonlySet<string>>;
}): {
  rows: TimesheetRow[];
  hiddenProjects: Array<{ id: string; name: string }>;
} {
  const {
    entries,
    days,
    orgProjects,
    assignedProjectIds,
    hiddenProjectIds,
    activityTypes,
    allowedByProject,
  } = params;
  const activityMode = activityTypes.some((t) => !t.isArchived);
  const activityById = new Map(activityTypes.map((t) => [t.id, t]));
  const daySet = new Set(days);
  const rowMap = new Map<string, TimesheetRow>();
  const projectsWithEntries = new Set<string>();

  const ensureRow = (
    projectId: string | null,
    projectName: string,
    activityTypeId: string | null,
    source: TimesheetRowSource,
  ): TimesheetRow => {
    const key = timesheetRowKey(projectId, activityTypeId);
    let row = rowMap.get(key);
    if (!row) {
      const activity = activityTypeId
        ? activityById.get(activityTypeId)
        : undefined;
      row = {
        projectId,
        projectName,
        activityTypeId,
        activityName: activityTypeId
          ? (activity?.name ?? "Ukendt aktivitet")
          : activityMode
            ? "(uden aktivitet)"
            : null,
        activityColor: activity?.color ?? null,
        source,
        hidden: projectId ? hiddenProjectIds.has(projectId) : false,
        days: {},
      };
      rowMap.set(key, row);
    }
    return row;
  };

  for (const entry of entries) {
    if (!daySet.has(entry.date)) continue;
    if (entry.projectId) projectsWithEntries.add(entry.projectId);
    // Uden aktivitetstyper i org'en samles alt pr. projekt som før
    const activityTypeId = activityMode ? entry.activityTypeId : null;
    const row = ensureRow(
      entry.projectId,
      entry.projectName ?? syncT("common.noProject"),
      activityTypeId,
      "entries",
    );
    const cell = row.days[entry.date] ?? {
      total: 0,
      timesheetHours: 0,
      note: null,
    };
    cell.total = round2(cell.total + entry.hours);
    if (entry.source === TIMESHEET_SOURCE) {
      cell.timesheetHours = round2(cell.timesheetHours + entry.hours);
      // "Timeseddel" var den hardkodede beskrivelse før #467 → ingen note
      cell.note = cell.note ?? descriptionToNote(entry.description);
    }
    row.days[entry.date] = cell;
  }

  // Faste rækker: tildelte ∪ availableToAll minus skjulte. Et skjult projekt
  // med timer i ugen er allerede med ovenfor.
  const hiddenProjects: Array<{ id: string; name: string }> = [];
  const visibleProjects = new Map<
    string,
    { name: string; source: TimesheetRowSource }
  >();
  for (const project of orgProjects) {
    if (projectsWithEntries.has(project.id)) {
      visibleProjects.set(project.id, {
        name: project.name,
        source: "entries",
      });
      continue;
    }
    const isFixed =
      assignedProjectIds.has(project.id) || Boolean(project.availableToAll);
    if (!isFixed) continue;
    if (hiddenProjectIds.has(project.id)) {
      hiddenProjects.push({ id: project.id, name: project.name });
      continue;
    }
    visibleProjects.set(project.id, {
      name: project.name,
      source: assignedProjectIds.has(project.id) ? "assigned" : "all",
    });
  }
  hiddenProjects.sort((a, b) => a.name.localeCompare(b.name, "da"));

  // Standardrækker pr. synligt projekt: tilladte aktiviteter (activityMode)
  // eller én tom projektrække (uændret adfærd uden aktivitetstyper).
  for (const [projectId, { name, source }] of visibleProjects) {
    if (!activityMode) {
      ensureRow(projectId, name, null, source);
      continue;
    }
    for (const activity of allowedActivitiesForProject(
      projectId,
      activityTypes,
      allowedByProject,
    )) {
      ensureRow(projectId, name, activity.id, source);
    }
  }

  const rows = Array.from(rowMap.values()).sort((a, b) => {
    // syncT("common.noProject") sidst — UI'et filtrerer den alligevel ud i egen række
    if ((a.projectId === null) !== (b.projectId === null)) {
      return a.projectId === null ? 1 : -1;
    }
    const byProject = a.projectName.localeCompare(b.projectName, "da");
    if (byProject !== 0) return byProject;
    if ((a.activityTypeId === null) !== (b.activityTypeId === null)) {
      return a.activityTypeId === null ? 1 : -1;
    }
    const aAct = a.activityTypeId ? activityById.get(a.activityTypeId) : null;
    const bAct = b.activityTypeId ? activityById.get(b.activityTypeId) : null;
    return (
      (aAct?.sortOrder ?? 0) - (bAct?.sortOrder ?? 0) ||
      (a.activityName ?? "").localeCompare(b.activityName ?? "", "da")
    );
  });

  return { rows, hiddenProjects };
}

// ---------------------------------------------------------------------------
// Ugegrid-visning (#475): kollapsede projektgrupper og kun rækker med timer
// ---------------------------------------------------------------------------

/**
 * Brugerens huskede rækketilstand pr. projekt (localStorage, nøgle pr.
 * org+bruger): "open"/"closed" overstyrer standarden (kollapset uden timer),
 * og `added` er aktivitetsrækker brugeren selv har tilføjet som tomme rækker.
 */
export type TimesheetRowState = {
  toggles: Record<string, "open" | "closed">;
  /** Rækkenøgler (timesheetRowKey) tilføjet lokalt via "+ Tilføj aktivitet" */
  added: string[];
};

export const EMPTY_ROW_STATE: TimesheetRowState = { toggles: {}, added: [] };

export function timesheetRowStateKey(orgId: string, userId: string): string {
  return `timesheet:rowState:${orgId}:${userId}`;
}

export type ProjectGroupView<R extends TimesheetRow = TimesheetRow> = {
  projectId: string;
  projectName: string;
  source: TimesheetRowSource;
  /** Projektets ugetotal (alle aktiviteter inkl. legacy) */
  total: number;
  /** Timer i ugen → ekspanderet som standard */
  hasHours: boolean;
  expanded: boolean;
  /** Synlige rækker: med timer, eller tilføjet af brugeren */
  rows: R[];
  /** Tilladte aktiviteter der kan tilføjes som tom række */
  addable: Array<{ id: string; name: string; color: string | null }>;
  /** Antal aktivitetsrækker i alt (tilladte ∪ med timer) */
  activityCount: number;
};

function rowTotal(row: TimesheetRow, days: readonly string[]): number {
  return round2(days.reduce((sum, d) => sum + (row.days[d]?.total ?? 0), 0));
}

/**
 * Gruppér grid-rækker pr. projekt til visning (#475). Grupper uden timer i
 * ugen er kollapset som standard; en ekspanderet gruppe viser kun rækker
 * med timer (legacy-rækken "(uden aktivitet)" kun hvis den har timer) samt
 * rækker brugeren selv har tilføjet. Resten tilbydes via `addable`.
 * Rækkefølgen fra buildTimesheetRows bevares; syncT("common.noProject") springes over.
 */
export function groupTimesheetRows<R extends TimesheetRow>(
  rows: readonly R[],
  params: {
    days: readonly string[];
    state: TimesheetRowState;
    /** false = org uden aktivitetstyper: én flad række pr. projekt, altid vist */
    activityMode?: boolean;
  },
): ProjectGroupView<R>[] {
  const { days, state, activityMode = true } = params;
  const added = new Set(state.added);
  const byProject = new Map<string, { head: R; all: R[] }>();

  for (const row of rows) {
    if (!row.projectId) continue;
    const group = byProject.get(row.projectId);
    if (group) group.all.push(row);
    else byProject.set(row.projectId, { head: row, all: [row] });
  }

  return Array.from(byProject.values()).map(({ head, all }) => {
    const projectId = head.projectId as string;
    const total = round2(all.reduce((sum, r) => sum + rowTotal(r, days), 0));
    const hasHours = total > 0.005;
    const override = state.toggles[projectId];
    const expanded =
      !activityMode || (override ? override === "open" : hasHours);
    const visible: R[] = [];
    const addable: ProjectGroupView["addable"] = [];
    for (const row of all) {
      const key = timesheetRowKey(row.projectId, row.activityTypeId);
      const withHours = rowTotal(row, days) > 0.005;
      if (!activityMode || withHours || added.has(key)) {
        visible.push(row);
      } else if (row.activityTypeId) {
        addable.push({
          id: row.activityTypeId,
          name: row.activityName ?? "Ukendt aktivitet",
          color: row.activityColor,
        });
      }
      // Legacy-rækken uden timer udelades helt — nye timer skal på en aktivitet
    }
    return {
      projectId,
      projectName: head.projectName,
      source: head.source,
      total,
      hasHours,
      expanded,
      rows: visible,
      addable,
      activityCount: all.length,
    };
  });
}
