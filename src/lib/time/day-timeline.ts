/**
 * Fælles dags-tidslinje: entries + segmenter foldet ud til intervaller pr. dag,
 * med pauser (huller mellem tidsstemplede intervaller) og en opsummering.
 *
 * Kernen bruges af Logbogen (dayDetail), Teamoverblikket og spildtidsloggen,
 * så "pause" betyder præcis det samme alle tre steder.
 *
 * Semantik (uændret fra Logbogens oprindelige buildDayDetails):
 * - Har en entry segmenter, udstilles segmenterne som intervaller i stedet for
 *   entryens egen start/slut.
 * - Intervaller uden tidspunkter (manual/import) medtages med
 *   hasTimestamps: false, men indgår ikke i gap-beregningen.
 * - Overlappende intervaller giver ingen falske pauser (løbende maxEnd).
 */

import { and, asc, gte, inArray, lt, ne } from "drizzle-orm";
import type { db as defaultDb } from "@/lib/db";
import { timeEntries, timeEntrySegments } from "@/lib/db/schema";
import { usersTimeEntriesInOrg } from "@/lib/enterprise/time-entry-scope";
import { toLocalDateStr } from "@/lib/format";
import { startOfNextDay } from "@/lib/time/date-bounds";

type Db = typeof defaultDb;

export interface DayTimelineEntryRow {
  id: string;
  date: Date;
  startTime: Date | null;
  endTime: Date | null;
  hours: string;
  description: string | null;
  source: string | null;
  projectName: string | null;
  clientName: string | null;
  /** Kun sat af loaderen — bruges til at gruppere flere brugere. */
  userId?: string;
  /** Kun nødvendig når options.excludeRejected er sat. */
  approvalStatus?: string | null;
}

export interface DayTimelineSegmentRow {
  timeEntryId: string;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
}

export interface DayTimelineInterval {
  start: string | null;
  end: string | null;
  hours: number;
  description: string | null;
  projectName: string | null;
  clientName: string | null;
  source: string | null;
  hasTimestamps: boolean;
  /**
   * Ærligheds-flag: true når start/slut er udledt af timerens varighed
   * (source "timer" uden rigtige segmenter — pauser er kollapset).
   * Segment-intervaller har ægte tidspunkter og er aldrig syntetiske.
   */
  synthetic: boolean;
}

export interface DayTimelineGap {
  afterIndex: number;
  minutes: number;
}

/**
 * Som DayTimelineGap, men med begge naboer. `afterIndex` peger på det
 * interval der ejer det dækkede spans slut — ved overlap er det ikke
 * nødvendigvis intervallet lige før i rækkefølgen — og `beforeIndex` på
 * intervallet der genoptager arbejdet. Konsumenter der skal vise
 * "kl. X–Y, efter opgave Z" skal bruge denne; `gaps` er den minimale
 * projektion som Logbogens UI (og dens tests) bygger på.
 */
export interface DayTimelineGapDetail extends DayTimelineGap {
  beforeIndex: number;
}

export interface DayTimelineSummary {
  /** Sum af de pauser der overlevede minGapMinutes-filteret. */
  gapMinutes: number;
  /** Første start → sidste slut på dagen (0 uden tidsstemplede intervaller). */
  spanMinutes: number;
  /** Union af de tidsstemplede intervaller — dobbeltbookning tæller én gang. */
  workedMinutes: number;
  /** Registreringer uden start/slut (rene varighedsregistreringer). */
  untimedEntries: number;
  /** Intervaller hvor start/slut er udledt af timerens varighed. */
  syntheticEntries: number;
}

export interface DayTimeline {
  date: string; // YYYY-MM-DD
  intervals: DayTimelineInterval[];
  /** Huller mellem tidsstemplede intervaller (pauser). */
  gaps: DayTimelineGap[];
  /** Samme huller med begge naboer — se DayTimelineGapDetail. */
  gapDetails: DayTimelineGapDetail[];
  /** Sum af dagens entries' hours — samme kilde som weekOverview-cellen. */
  totalHours: number;
  summary: DayTimelineSummary;
}

export interface BuildDayTimelineOptions {
  /**
   * Mindste hul der tæller som pause. 0 (default) = alt >0 min tæller, som
   * Logbogen altid har gjort. Spildtidsloggen bruger 15 min.
   */
  minGapMinutes?: number;
  /**
   * Udelad afviste registreringer. Logbogen har historisk ikke filtreret
   * (false = uændret adfærd); Teamoverblik og rapporter filtrerer.
   */
  excludeRejected?: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Fold entries + segmenter ud til dags-tidslinjer.
 */
export function buildDayTimeline(
  entries: DayTimelineEntryRow[],
  segments: DayTimelineSegmentRow[],
  options: BuildDayTimelineOptions = {},
): DayTimeline[] {
  const minGapMinutes = options.minGapMinutes ?? 0;
  const excludeRejected = options.excludeRejected ?? false;

  const visibleEntries = excludeRejected
    ? entries.filter((e) => e.approvalStatus !== "rejected")
    : entries;

  const segsByEntry = new Map<string, DayTimelineSegmentRow[]>();
  for (const s of segments) {
    const list = segsByEntry.get(s.timeEntryId) ?? [];
    list.push(s);
    segsByEntry.set(s.timeEntryId, list);
  }

  const byDay = new Map<
    string,
    { intervals: DayTimelineInterval[]; entryHours: number }
  >();
  for (const e of visibleEntries) {
    const dayKey = toLocalDateStr(e.date);
    const day = byDay.get(dayKey) ?? { intervals: [], entryHours: 0 };
    day.entryHours += Number.parseFloat(e.hours) || 0;
    const segs = segsByEntry.get(e.id);
    if (segs && segs.length > 0) {
      const sorted = [...segs].sort(
        (a, b) => a.startTime.getTime() - b.startTime.getTime(),
      );
      for (const s of sorted) {
        day.intervals.push({
          start: s.startTime.toISOString(),
          end: s.endTime.toISOString(),
          hours: round2(s.durationMinutes / 60),
          description: e.description,
          projectName: e.projectName,
          clientName: e.clientName,
          source: e.source,
          hasTimestamps: true,
          // Segment-tidspunkter er ægte, uanset entryens source
          synthetic: false,
        });
      }
    } else {
      const hasTimestamps = e.startTime !== null && e.endTime !== null;
      day.intervals.push({
        start: e.startTime ? e.startTime.toISOString() : null,
        end: e.endTime ? e.endTime.toISOString() : null,
        hours: round2(Number.parseFloat(e.hours) || 0),
        description: e.description,
        projectName: e.projectName,
        clientName: e.clientName,
        source: e.source,
        hasTimestamps,
        synthetic: hasTimestamps && e.source === "timer",
      });
    }
    byDay.set(dayKey, day);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { intervals, entryHours }]) => {
      // Tidsstemplede intervaller først, sorteret på start; resten bevarer
      // rækkefølgen sidst (nulls last).
      intervals.sort((a, b) => {
        if (a.start && b.start) return a.start.localeCompare(b.start);
        if (a.start) return -1;
        if (b.start) return 1;
        return 0;
      });

      // Pauser: løbende maxEnd så overlappende intervaller ikke giver
      // falske pauser (fx 09-13 + 09:30-10 + 10:30-12 er ét dækket span).
      const gapDetails: DayTimelineGapDetail[] = [];
      let maxEnd: number | null = null;
      // Hvilket interval der ejer maxEnd. Pausen kommer efter DET interval,
      // ikke nødvendigvis efter det foregående i rækkefølgen: med 09–13 +
      // 09:30–10 + 14–15 slutter det dækkede span ved 09–13-posten, så
      // pausen skal citere den — ikke 09:30–10.
      let maxEndIndex = -1;
      let firstStart: number | null = null;
      let workedMs = 0;
      let untimedEntries = 0;
      let syntheticEntries = 0;

      for (let i = 0; i < intervals.length; i++) {
        const iv = intervals[i];
        if (iv.synthetic) syntheticEntries++;
        if (!iv.hasTimestamps || !iv.start || !iv.end) {
          untimedEntries++;
          continue;
        }
        const start = Date.parse(iv.start);
        const end = Date.parse(iv.end);
        if (firstStart === null) firstStart = start;
        if (maxEnd !== null && start > maxEnd) {
          const minutes = Math.round((start - maxEnd) / 60000);
          if (minutes > 0 && minutes >= minGapMinutes) {
            gapDetails.push({
              afterIndex: maxEndIndex,
              beforeIndex: i,
              minutes,
            });
          }
        }
        // Union: kun den del af intervallet der ikke allerede er dækket.
        const coveredFrom = maxEnd === null ? start : Math.max(start, maxEnd);
        if (end > coveredFrom) workedMs += end - coveredFrom;
        if (maxEnd === null || end > maxEnd) {
          maxEnd = end;
          maxEndIndex = i;
        }
      }

      const spanMinutes =
        firstStart !== null && maxEnd !== null
          ? Math.round((maxEnd - firstStart) / 60000)
          : 0;

      return {
        date,
        intervals,
        gaps: gapDetails.map(({ afterIndex, minutes }) => ({
          afterIndex,
          minutes,
        })),
        gapDetails,
        // Samme kilde som weekOverview-cellen (SUM af entries' hours), så
        // detaljen aldrig afviger fra matrixen pga. afrundede segment-timer.
        totalHours: round2(entryHours),
        summary: {
          // Bemærk: med minGapMinutes > 0 er workedMinutes + gapMinutes
          // mindre end spanMinutes — de bortfiltrerede småhuller mangler.
          gapMinutes: gapDetails.reduce((sum, g) => sum + g.minutes, 0),
          spanMinutes,
          workedMinutes: Math.round(workedMs / 60000),
          untimedEntries,
          syntheticEntries,
        },
      };
    });
}

export interface LoadDayTimelineRowsArgs {
  /** Aktiv organisation; null for solo-brugere (falder tilbage til userIds). */
  orgId: string | null;
  /**
   * De brugere der må læses. Loaderen laver INGEN adgangskontrol — kalderen
   * skal have afgjort hvem sessionen må se (assertDayDetailAccess,
   * canViewAllOrgTime e.l.) FØR den kalder her. Uden org er userIds den
   * eneste afgrænsning, så den må aldrig indeholde fremmede brugere.
   */
  userIds: string[];
  /** Inklusiv start- og slutdato. */
  from: Date;
  to: Date;
  /** Udelad afviste registreringer allerede i SQL'en. */
  excludeRejected?: boolean;
}

/**
 * Fælles loader til dags-tidslinjer: entries (med projekt/kunde-navne) plus
 * deres segmenter. Bruges af logbook.dayDetail og logbook.wasteLog, så begge
 * ser præcis de samme rækker.
 */
export async function loadDayTimelineRows(
  db: Db,
  {
    orgId,
    userIds,
    from,
    to,
    excludeRejected = false,
  }: LoadDayTimelineRowsArgs,
): Promise<{
  entries: DayTimelineEntryRow[];
  segments: DayTimelineSegmentRow[];
}> {
  if (userIds.length === 0) return { entries: [], segments: [] };

  // usersTimeEntriesInOrg medtager legacy-poster uden organization_id (de
  // tilhører stadig ejeren, #445). Et strengt eq() ville tabe dem — og i en
  // spildtidsvisning ser en manglende 13–16-postering ud som 3 t spildtid.
  const scopeFilter = orgId
    ? usersTimeEntriesInOrg(userIds, orgId)
    : inArray(timeEntries.userId, userIds);

  const rows = await db.query.timeEntries.findMany({
    where: and(
      scopeFilter,
      gte(timeEntries.date, from),
      // `to` er sidste dag (inklusiv) — tag hele dagen med.
      lt(timeEntries.date, startOfNextDay(to)),
      excludeRejected ? ne(timeEntries.approvalStatus, "rejected") : undefined,
    ),
    columns: {
      id: true,
      userId: true,
      date: true,
      startTime: true,
      endTime: true,
      hours: true,
      description: true,
      source: true,
      approvalStatus: true,
    },
    with: {
      project: {
        columns: { name: true },
        with: { client: { columns: { name: true } } },
      },
      client: { columns: { name: true } },
    },
    orderBy: [asc(timeEntries.date), asc(timeEntries.startTime)],
  });

  const entries: DayTimelineEntryRow[] = rows.map((r) => ({
    id: r.id,
    userId: r.userId ?? undefined,
    date: r.date,
    startTime: r.startTime,
    endTime: r.endTime,
    hours: r.hours,
    description: r.description,
    source: r.source,
    approvalStatus: r.approvalStatus,
    projectName: r.project?.name ?? null,
    clientName: r.client?.name ?? r.project?.client?.name ?? null,
  }));

  const entryIds = entries.map((e) => e.id);
  const segments =
    entryIds.length > 0
      ? await db.query.timeEntrySegments.findMany({
          where: inArray(timeEntrySegments.timeEntryId, entryIds),
          columns: {
            timeEntryId: true,
            startTime: true,
            endTime: true,
            durationMinutes: true,
          },
          orderBy: [asc(timeEntrySegments.startTime)],
        })
      : [];

  return { entries, segments };
}
