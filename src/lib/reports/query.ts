// src/lib/reports/query.ts
import { and, eq, exists, gte, inArray, lt, sql } from "drizzle-orm";
import type { db as defaultDb } from "@/lib/db";
import { timeEntries, timeEntryTags, users } from "@/lib/db/schema";
import { inOrgOrOwnLegacy } from "@/lib/enterprise/time-entry-scope";
import { isUnbilledEntry } from "@/lib/invoicing/unbilled";
import {
  type BudgetHealthStatus,
  monthKeyCopenhagen,
  monthlyBudgetStatus,
} from "@/lib/projects/budget";
import {
  loadMonthlyUsage,
  monthlyUsageScope,
} from "@/lib/projects/monthly-usage";
import { startOfNextDay } from "@/lib/time/date-bounds";
import { resolveRoundingConfig, roundHours } from "@/lib/utils/rounding";
import type { ReportEntry } from "./columns";
import type { ReportTemplateConfig } from "./config-schema";
import { computeReportPauses, type ReportPauses } from "./pauses";

type Db = typeof defaultDb;

// Re-exported from ./date-range so existing server-side imports keep working;
// client components import from ./date-range directly (no drizzle in bundle).
import { resolveDateRange } from "./date-range";

export { resolveDateRange };

export interface ReportAggregates {
  summary: {
    totalHours: number;
    totalRevenue: number;
    billedHours: number;
    billedRevenue: number;
    unbilledHours: number;
    unbilledRevenue: number;
    entriesCount: number;
  };
  groups: Array<{
    key: string;
    label: string;
    hours: number;
    revenue: number;
    entries: ReportEntry[];
    /** Månedsbudget for gruppen — kun ved projekt-/kunde+projekt-gruppering */
    budget: ReportGroupBudget | null;
  }>;
  /**
   * Dansk note der skal vises sammen med grupperingen, fx når en post kan
   * tælle i flere grupper. `null` = ingen note.
   */
  groupingNote: string | null;
  /** Pauser pr. dag — kun beregnet når `opts.includePauses` er sat (#593). */
  pauses: ReportPauses | null;
}

export interface ReportGroupBudget {
  /** Projektets månedsbudget for den viste måned */
  budgetHours: number;
  /**
   * Månedens SAMLEDE forbrug på projektet — hentet med samme helper og samme
   * scope som projektlisten, altså UAFHÆNGIGT af rapportens filtre. Ellers
   * ville en rapport filtreret på én medarbejder vise 20 % hvor listen viser
   * 90 % for det samme projekt i den samme måned.
   */
  usedHours: number;
  percentage: number;
  healthStatus: BudgetHealthStatus;
  /** Måneden budgettet gælder, "YYYY-MM" */
  month: string;
}

export interface AggregateOptions {
  /**
   * Månedens forbrug pr. projekt, hentet med `loadMonthlyUsage`. Mangler den,
   * bliver `group.budget` null og kolonnen skjules — sådan opfører det sig
   * bl.a. når rapportperioden strækker sig over mere end én kalendermåned.
   */
  budgetUsageByProject?: Map<string, number>;
  /** Måneden ovenstående forbrug gælder, "YYYY-MM". */
  budgetMonth?: string;
  /** Beregn pauser (huller) pr. medarbejder og dag. Default false. */
  includePauses?: boolean;
}

/**
 * Månedsnøglen (dansk tid) hvis HELE perioden ligger i én kalendermåned —
 * ellers null.
 *
 * Et månedsbudget kan ikke meningsfuldt sammenlignes med en vilkårlig
 * periode: "sidste 30 dage" (15/1–13/2) rører to måneder, og at gange
 * budgettet med 2 ville gøre et rødt projekt grønt. Derfor vises budgettet
 * kun for en enkelt måned, og ellers "—".
 */
export function budgetMonthForRange(start: Date, end: Date): string | null {
  const a = monthKeyCopenhagen(start);
  return a === monthKeyCopenhagen(end) ? a : null;
}

const MULTI_TAG_NOTE =
  "Poster med flere tags tælles i hver gruppe — summen kan overstige totalen.";

export function aggregateReport(
  entries: ReportEntry[],
  grouping: ReportTemplateConfig["grouping"],
  opts: AggregateOptions = {},
): ReportAggregates {
  let totalHours = 0;
  let totalRevenue = 0;
  let billedHours = 0;
  let billedRevenue = 0;
  let unbilledHours = 0;
  let unbilledRevenue = 0;

  for (const e of entries) {
    const h = e._rounded ?? Number.parseFloat(e.hours);
    const v = e._value;
    totalHours += h;
    totalRevenue += v;
    if (e.isBilled) {
      billedHours += h;
      billedRevenue += v;
    }
    // "Ufaktureret" er IKKE længere total − faktureret (#626). Det gamle
    // regnestykke talte intern tid (#541), eksplicit ikke-fakturerbar tid,
    // klippekort-timer og tid uden kunde med i et beløb der lovede at kunne
    // faktureres — og gav derfor et markant højere tal end både dashboardet
    // og /api/v1/reports/unbilled for den samme periode. Summen af
    // faktureret + ufaktureret er dermed bevidst mindre end totalen:
    // forskellen er tid der ikke er klar til fakturering. Noget af den kan
    // blive det senere — tid der afventer godkendelse især — så differencen
    // må ikke læses som "kan aldrig faktureres".
    if (isUnbilledEntry(e)) {
      unbilledHours += h;
      unbilledRevenue += v;
    }
  }

  const summary = {
    totalHours,
    totalRevenue,
    billedHours,
    billedRevenue,
    unbilledHours,
    unbilledRevenue,
    entriesCount: entries.length,
  };

  const pauses = opts.includePauses ? computeReportPauses(entries) : null;

  if (grouping === "none") {
    return { summary, groups: [], groupingNote: null, pauses };
  }

  const groups = new Map<
    string,
    {
      key: string;
      label: string;
      hours: number;
      revenue: number;
      entries: ReportEntry[];
      budget: ReportGroupBudget | null;
    }
  >();

  for (const e of entries) {
    // Tag-gruppering kan give flere grupper pr. post; alle andre giver én.
    for (const { key, label } of groupKeysFor(e, grouping)) {
      const g = groups.get(key) ?? {
        key,
        label,
        hours: 0,
        revenue: 0,
        entries: [],
        budget: null,
      };
      g.hours += e._rounded ?? Number.parseFloat(e.hours);
      g.revenue += e._value;
      g.entries.push(e);
      groups.set(key, g);
    }
  }

  // Budget giver kun mening når gruppen ER et projekt, og kun når kalderen
  // har hentet månedens forbrug (én kalendermåned, samme scope som listen).
  const usage = opts.budgetUsageByProject;
  const budgetMonth = opts.budgetMonth;
  if (
    usage &&
    budgetMonth &&
    (grouping === "project" || grouping === "clientProject")
  ) {
    for (const g of groups.values()) {
      const project = g.entries.find(
        (e) => e.project?.monthlyBudgetHours != null,
      )?.project;
      const monthly = project?.monthlyBudgetHours;
      if (!project || monthly == null || monthly <= 0) continue;
      // Månedens fulde forbrug — ikke gruppens (filtrerede, afrundede) timer
      const usedHours = usage.get(project.id);
      if (usedHours === undefined) continue;
      const status = monthlyBudgetStatus(monthly, usedHours);
      g.budget = {
        budgetHours: monthly,
        usedHours: Math.round(usedHours * 10) / 10,
        percentage: status.percentage,
        healthStatus: status.healthStatus,
        month: budgetMonth,
      };
    }
  }

  return {
    summary,
    groups: Array.from(groups.values()).sort((a, b) => b.hours - a.hours),
    groupingNote: grouping === "tag" ? MULTI_TAG_NOTE : null,
    pauses,
  };
}

interface GroupRef {
  key: string;
  label: string;
}

/**
 * Grupperne en post hører til. Alle grupperinger giver præcis én gruppe —
 * undtagen "tag", hvor en post med flere tags tælles i hver af dem
 * (besluttet, #593). Poster uden tag samles under "Uden tag".
 */
function groupKeysFor(
  e: ReportEntry,
  grouping: ReportTemplateConfig["grouping"],
): GroupRef[] {
  if (grouping === "tag") {
    if (e.tags.length === 0) {
      return [{ key: "_none", label: "Uden tag" }];
    }
    return e.tags.map((t) => ({ key: t.id, label: t.name }));
  }
  return [groupKeyFor(e, grouping)];
}

function groupKeyFor(
  e: ReportEntry,
  grouping: ReportTemplateConfig["grouping"],
): { key: string; label: string } {
  switch (grouping) {
    case "client": {
      const c = e.client ?? e.project?.client;
      return { key: c?.id ?? "_none", label: c?.name ?? "(Ingen kunde)" };
    }
    case "project":
      return {
        key: e.project?.id ?? "_none",
        label: e.project?.name ?? "(Intet projekt)",
      };
    case "clientProject": {
      const c = e.client ?? e.project?.client;
      const clientName = c?.name ?? "(Ingen kunde)";
      const projectName = e.project?.name ?? "(Intet projekt)";
      return {
        key: `${c?.id ?? ""}:${e.project?.id ?? ""}`,
        label: `${clientName} — ${projectName}`,
      };
    }
    case "task": {
      if (e.task?.id) {
        return { key: e.task.id, label: e.task.title };
      }
      const desc = e.description ?? "";
      const cId = e.client?.id ?? e.project?.client?.id;
      const projId = e.project?.id;
      if (desc && (cId || projId)) {
        return { key: `${cId ?? ""}:${projId ?? ""}:${desc}`, label: desc };
      }
      return { key: "_none", label: "(Ingen opgave)" };
    }
    case "member":
      return {
        key: e.member?.userId ?? "_none",
        label: e.member?.name ?? "(Ingen medarbejder)",
      };
    case "day":
    case "week":
    case "month": {
      const d = e.date;
      const key =
        grouping === "day"
          ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
          : grouping === "month"
            ? `${d.getFullYear()}-${d.getMonth() + 1}`
            : `${d.getFullYear()}-w${isoWeek(d)}`;
      return { key, label: key };
    }
    default:
      return { key: "_all", label: "Alle" };
  }
}

function isoWeek(d: Date): number {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
}

export interface LoadReportEntriesOpts {
  userId: string;
  organizationId?: string | null;
  config: ReportTemplateConfig;
  /**
   * When true, restrict the report to the caller's own entries even inside an
   * org. Set for non-owner members so a report can't expose the whole team's
   * time and revenue — mirroring the time.list visibility rule.
   */
  restrictToOwnEntries?: boolean;
}

/**
 * Månedens forbrug pr. projekt til budget-kolonnen — eller `null` når
 * perioden ikke ligger inden for én kalendermåned. Hentes med samme helper og
 * scope som projektlisten, så de to steder aldrig viser forskellige tal.
 */
export async function loadReportBudgetUsage(
  db: Db,
  opts: {
    entries: ReportEntry[];
    userId: string;
    organizationId?: string | null;
    start: Date;
    end: Date;
  },
): Promise<{ month: string; usageByProject: Map<string, number> } | null> {
  const month = budgetMonthForRange(opts.start, opts.end);
  if (!month) return null;
  const projectIds = [
    ...new Set(
      opts.entries
        .filter((e) => e.project?.monthlyBudgetHours != null)
        .map((e) => e.project?.id)
        .filter((id): id is string => !!id),
    ),
  ];
  if (projectIds.length === 0) return null;
  const usageByProject = await loadMonthlyUsage(db, {
    projectIds,
    scope: monthlyUsageScope(opts.organizationId ?? null, opts.userId),
    // Et hvilket som helst tidspunkt i måneden giver de rigtige grænser
    now: opts.start,
  });
  return { month, usageByProject };
}

export async function loadReportEntries(
  db: Db,
  opts: LoadReportEntriesOpts,
): Promise<ReportEntry[]> {
  const { userId, organizationId, config, restrictToOwnEntries } = opts;
  const { start, end } = resolveDateRange(config.filters);

  // Non-owner members are scoped to their own entries even within the org.
  // inOrgOrLegacy frem for en streng lighed: poster fra før multi-tenant har
  // organization_id = NULL og tilhører stadig ejeren. Uden dem forsvinder
  // gamle timer fra rapporten — og pause-beregningen ville se falske huller
  // hvor de gamle poster ligger (#593). Kun brugerens EGNE legacy-poster:
  // org-løse poster fra andre brugere hører ikke til denne org.
  const scopeFilter =
    organizationId && !restrictToOwnEntries
      ? inOrgOrOwnLegacy(organizationId, userId)
      : eq(timeEntries.userId, userId);
  const where = [
    scopeFilter,
    gte(timeEntries.date, start),
    // `end` er slutdagens midnat — tag hele dagen med.
    lt(timeEntries.date, startOfNextDay(end)),
  ];

  if (config.filters.clientIds.length > 0) {
    where.push(inArray(timeEntries.clientId, config.filters.clientIds));
  }
  if (config.filters.projectIds.length > 0) {
    where.push(inArray(timeEntries.projectId, config.filters.projectIds));
  }
  if (config.filters.billedStatus === "billed") {
    where.push(eq(timeEntries.isBilled, true));
  } else if (config.filters.billedStatus === "unbilled") {
    where.push(eq(timeEntries.isBilled, false));
  }
  if (config.filters.billable === "billable") {
    where.push(eq(timeEntries.isBillable, true));
  } else if (config.filters.billable === "nonBillable") {
    where.push(eq(timeEntries.isBillable, false));
  }
  if (!config.filters.includePrepaid) {
    where.push(eq(timeEntries.isPrepaid, false));
  }

  if (config.filters.memberIds && config.filters.memberIds.length > 0) {
    where.push(inArray(timeEntries.userId, config.filters.memberIds));
  }
  // Tag filter: EXISTS on time_entry_tags — an entry matches when it has at
  // least one of the selected tags. Without this the filter was a silent
  // no-op: configs with tagIds got a report that ignored them (#191).
  if (config.filters.tagIds.length > 0) {
    where.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(timeEntryTags)
          .where(
            and(
              eq(timeEntryTags.entryId, timeEntries.id),
              inArray(timeEntryTags.tagId, config.filters.tagIds),
            ),
          ),
      ),
    );
  }

  // Apply per-member client-access restriction, mirroring time.list so a
  // member who can't see a client's entries in the list can't see them
  // (or their totals) via reports either. Internal time (no client) stays
  // visible.
  if (organizationId) {
    const { getAccessibleClientIds } = await import(
      "@/lib/trpc/routers/clientAccess"
    );
    const accessibleIds = await getAccessibleClientIds(
      db,
      userId,
      organizationId,
    );
    if (accessibleIds !== null) {
      const resolvedClient = sql`COALESCE(${timeEntries.clientId}, (SELECT p.client_id FROM projects p WHERE p.id = ${timeEntries.projectId}))`;
      if (accessibleIds.length === 0) {
        where.push(sql`${resolvedClient} IS NULL`);
      } else {
        where.push(
          sql`(${resolvedClient} IS NULL OR ${resolvedClient} IN (${sql.join(
            accessibleIds.map((id) => sql`${id}`),
            sql`, `,
          )}))`,
        );
      }
    }
  }

  const [rows, userRow] = await Promise.all([
    db.query.timeEntries.findMany({
      where: and(...where),
      with: {
        project: { with: { client: true } },
        client: true,
        prepaidPackage: true,
        // Segmenter: gap-kernen bruger dem til de rigtige tidspunkter når en
        // timer er blevet sat på pause (#593). Joines KUN når pause-sektionen
        // er slået til — ellers er det et unødigt join på hver rapport.
        ...(config.branding.showPauses
          ? {
              segments: {
                columns: {
                  startTime: true,
                  endTime: true,
                  durationMinutes: true,
                },
              },
            }
          : {}),
        tags: { with: { tag: true } },
        task: {
          columns: {
            id: true,
            title: true,
          },
        },
        user: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
    }),
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        roundingEnabled: true,
        roundingMinutes: true,
        roundingMethod: true,
      },
    }),
  ]);
  const userRounding = userRow ?? {
    roundingEnabled: null,
    roundingMinutes: null,
    roundingMethod: null,
  };

  const entries = rows.map((r): ReportEntry => {
    const clientRef = r.client ?? r.project?.client ?? null;
    const hours = Number.parseFloat(r.hours);
    const rate = Number.parseFloat(r.billableRate ?? "0");

    // Apply rounding based on config
    let rounded = hours;
    if (config.rounding !== "raw") {
      const rc = resolveRoundingConfig(
        userRounding,
        clientRef ?? {
          roundingEnabled: null,
          roundingMinutes: null,
          roundingMethod: null,
        },
        r.project ?? {
          roundingEnabled: null,
          roundingMinutes: null,
          roundingMethod: null,
        },
      );
      rounded = roundHours(hours, rc);
    }

    return {
      id: r.id,
      date: r.date,
      startTime: r.startTime ?? null,
      endTime: r.endTime ?? null,
      hours: r.hours,
      billableRate: r.billableRate,
      description: r.description,
      isBilled: r.isBilled ?? false,
      isBillable: r.isBillable ?? null,
      isPrepaid: r.isPrepaid ?? false,
      clientDefaultBillable: clientRef ? clientRef.defaultBillable : null,
      isFromTemplate: r.isFromTemplate ?? false,
      source: r.source ?? null,
      approvalStatus: r.approvalStatus ?? null,
      segments: (r.segments ?? []).map((sg) => ({
        startTime: sg.startTime,
        endTime: sg.endTime,
        durationMinutes: sg.durationMinutes,
      })),
      _rounded: rounded,
      _value: rounded * rate,
      client: clientRef ? { id: clientRef.id, name: clientRef.name } : null,
      project: r.project
        ? {
            id: r.project.id,
            name: r.project.name,
            client: r.project.client
              ? { id: r.project.client.id, name: r.project.client.name }
              : null,
            monthlyBudgetHours: r.project.monthlyBudgetHours
              ? Number.parseFloat(r.project.monthlyBudgetHours)
              : null,
          }
        : null,
      prepaidPackage: r.prepaidPackage
        ? { id: r.prepaidPackage.id, name: r.prepaidPackage.name }
        : null,
      tags: (r.tags ?? []).map((t) => ({ id: t.tag.id, name: t.tag.name })),
      task: r.task ? { id: r.task.id, title: r.task.title } : null,
      member: r.user
        ? { userId: r.user.id, name: r.user.name ?? "Ukendt" }
        : null,
    };
  });

  entries.sort((a, b) => {
    const dir = config.sortDir === "asc" ? 1 : -1;
    switch (config.sortBy) {
      case "date":
        return (a.date.getTime() - b.date.getTime()) * dir;
      case "hours":
        return (a._rounded - b._rounded) * dir;
      case "revenue":
        return (a._value - b._value) * dir;
      case "client":
        return (a.client?.name ?? "").localeCompare(b.client?.name ?? "") * dir;
      case "project":
        return (
          (a.project?.name ?? "").localeCompare(b.project?.name ?? "") * dir
        );
      default:
        return 0;
    }
  });

  return entries;
}
