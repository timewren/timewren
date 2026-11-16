/**
 * Pauser pr. dag i rapporten (#593 punkt c).
 *
 * Bygger på den fælles gap-kerne (`src/lib/time/day-timeline.ts`, #598), så
 * "pause" betyder præcis det samme i Logbogen, spildtidsloggen, Teamoverblikket
 * og rapporten. Beregningen sker pr. (medarbejder, dag): to personer der
 * arbejder på hver sin tid giver hver deres huller, ikke ét fælles.
 *
 * Input er PRÆCIS de poster rapporten i øvrigt viser. Spildtidsloggen kaster
 * afviste registreringer væk, men rapportens detaljetabel gør ikke — gjorde
 * pauserne det, ville en afvist 4-timers post stå i tabellen OG dukke op som
 * fire timers pause. Ét datasæt, ét billede.
 */

import {
  buildDayTimeline,
  type DayTimelineEntryRow,
  type DayTimelineSegmentRow,
} from "@/lib/time/day-timeline";
import type { ReportEntry } from "./columns";

/** Samme defaults som spildtidsloggen. */
export const REPORT_MIN_GAP_MINUTES = 15;

export interface ReportPauses {
  /** Sum af alle pauser over alle medarbejdere og dage. */
  totalGapMinutes: number;
  byDay: Array<{ date: string; gapMinutes: number }>;
  byUser: Array<{ userId: string; name: string; gapMinutes: number }>;
  /**
   * Registreringer uden start/slut (rene varighedsregistreringer). De kan
   * ikke indgå i pause-beregningen, så tallet skal vises sammen med den.
   */
  untimedEntries: number;
  /** Intervaller hvor start/slut er udledt af timerens varighed. */
  syntheticEntries: number;
  /** Tærsklen beregningen er kørt med — vises i noten. */
  minGapMinutes: number;
}

const UNKNOWN_USER = "_unknown";

function toTimelineRow(e: ReportEntry): DayTimelineEntryRow {
  return {
    id: e.id,
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    hours: e.hours,
    description: e.description,
    source: e.source,
    projectName: e.project?.name ?? null,
    clientName: e.client?.name ?? e.project?.client?.name ?? null,
    userId: e.member?.userId,
    approvalStatus: e.approvalStatus,
  };
}

/**
 * Pauser for rapportens poster. Returnerer altid et objekt — er der ingen
 * tidsstemplede poster, er alle tal 0.
 */
export function computeReportPauses(
  entries: ReportEntry[],
  minGapMinutes = REPORT_MIN_GAP_MINUTES,
): ReportPauses {
  const byUser = new Map<
    string,
    { name: string; entries: ReportEntry[]; segments: DayTimelineSegmentRow[] }
  >();

  for (const e of entries) {
    const userId = e.member?.userId ?? UNKNOWN_USER;
    const bucket = byUser.get(userId) ?? {
      name: e.member?.name ?? "Ukendt",
      entries: [],
      segments: [],
    };
    bucket.entries.push(e);
    for (const sg of e.segments) {
      bucket.segments.push({
        timeEntryId: e.id,
        startTime: sg.startTime,
        endTime: sg.endTime,
        durationMinutes: sg.durationMinutes,
      });
    }
    byUser.set(userId, bucket);
  }

  const gapByDay = new Map<string, number>();
  const userTotals: ReportPauses["byUser"] = [];
  let totalGapMinutes = 0;
  let untimedEntries = 0;
  let syntheticEntries = 0;

  for (const [userId, bucket] of byUser) {
    const days = buildDayTimeline(
      bucket.entries.map(toTimelineRow),
      bucket.segments,
      // excludeRejected: false — se filens hoved. Rapportens entry-sæt er
      // allerede filtreret af loadReportEntries; pauserne må ikke filtrere
      // videre på egen hånd.
      { minGapMinutes, excludeRejected: false },
    );
    let userGap = 0;
    for (const day of days) {
      userGap += day.summary.gapMinutes;
      untimedEntries += day.summary.untimedEntries;
      syntheticEntries += day.summary.syntheticEntries;
      gapByDay.set(
        day.date,
        (gapByDay.get(day.date) ?? 0) + day.summary.gapMinutes,
      );
    }
    totalGapMinutes += userGap;
    if (userGap > 0) {
      userTotals.push({ userId, name: bucket.name, gapMinutes: userGap });
    }
  }

  return {
    totalGapMinutes,
    byDay: [...gapByDay.entries()]
      .filter(([, minutes]) => minutes > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, gapMinutes]) => ({ date, gapMinutes })),
    byUser: userTotals.sort((a, b) => b.gapMinutes - a.gapMinutes),
    untimedEntries,
    syntheticEntries,
    minGapMinutes,
  };
}
