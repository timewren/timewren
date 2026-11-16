import { copenhagenParts } from "@/lib/time/copenhagen";
/**
 * Delte periodevalg for lister og rapporter (projektside, projektoversigt).
 * Ren TS uden React, så både tRPC-routere og klientkomponenter kan bruge dem.
 */

export type PeriodKey = "all" | "week" | "month" | "quarter" | "year";

export const PERIOD_KEYS = ["all", "week", "month", "quarter", "year"] as const;

export const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: "all", label: "Alt" },
  { key: "week", label: "Denne uge" },
  { key: "month", label: "Denne måned" },
  { key: "quarter", label: "Dette kvartal" },
  { key: "year", label: "I år" },
];

/** Kort label til kolonneoverskrifter o.l. */
export const PERIOD_SHORT_LABELS: Record<PeriodKey, string> = {
  all: "I alt",
  week: "Denne uge",
  month: "Denne måned",
  quarter: "Kvartal",
  year: "I år",
};

/**
 * Startdato (lokal midnat) for en periode — null = ingen nedre grænse.
 * Uge følger ISO (mandag), så en søndag hører til ugen der går forud.
 */
export function periodStart(period: PeriodKey, now = new Date()): Date | null {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  switch (period) {
    case "week": {
      const daysSinceMonday = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - daysSinceMonday);
      return d;
    }
    case "month":
      return new Date(d.getFullYear(), d.getMonth(), 1);
    case "quarter":
      return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
    case "year":
      return new Date(d.getFullYear(), 0, 1);
    default:
      return null;
  }
}

/**
 * Perioden umiddelbart før den valgte (samme type), til trend-sammenligning:
 * denne måned vs. forrige måned osv. `null` for "alt" (intet at sammenligne).
 */
export function previousPeriodRange(
  period: PeriodKey,
  now = new Date(),
): { from: Date; to: Date } | null {
  const from = periodStart(period, now);
  if (!from) return null;
  // Ét millisekund før periodens start ligger i den forrige periode
  const prevAnchor = new Date(from.getTime() - 1);
  const prevFrom = periodStart(period, prevAnchor);
  if (!prevFrom) return null;
  return { from: prevFrom, to: from };
}

/** Procentvis ændring; null når der ikke er et meningsfuldt sammenligningstal. */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Som `periodStart`, men i UTC. Serveren skal bruge denne: `time_entries.date`
 * gemmes med UTC-semantik (jf. `Date.UTC`-grænserne i månedsbudgettet), og
 * prod kører uden TZ sat. Uden den ville tallene skifte, hvis containeren en
 * dag fik `TZ=Europe/Copenhagen`. "I dag" er den danske dato (#649), så
 * perioden ikke hænger i gårsdagen/forrige måned mellem 00 og 02 dansk tid.
 */
export function periodStartUtc(
  period: PeriodKey,
  now = new Date(),
): Date | null {
  const today = copenhagenParts(now);
  const y = today.year;
  const m = today.month - 1;
  switch (period) {
    case "week": {
      const dow = new Date(Date.UTC(y, m, today.day)).getUTCDay();
      const daysSinceMonday = (dow + 6) % 7;
      return new Date(Date.UTC(y, m, today.day - daysSinceMonday, 0, 0, 0, 0));
    }
    case "month":
      return new Date(Date.UTC(y, m, 1));
    case "quarter":
      return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
    case "year":
      return new Date(Date.UTC(y, 0, 1));
    default:
      return null;
  }
}

/** UTC-variant af `previousPeriodRange` — se `periodStartUtc`. */
export function previousPeriodRangeUtc(
  period: PeriodKey,
  now = new Date(),
): { from: Date; to: Date } | null {
  const from = periodStartUtc(period, now);
  if (!from) return null;
  // Et døgn før starten (ikke 1 ms): UTC-midnat minus 1 ms er stadig samme
  // danske dato (00:59/01:59 dansk tid).
  const prevFrom = periodStartUtc(
    period,
    new Date(from.getTime() - 86_400_000),
  );
  if (!prevFrom) return null;
  return { from: prevFrom, to: from };
}

/**
 * Slutningen (eksklusiv) på perioden i UTC = starten på den næste. Bruges som
 * øvre grænse, så fremdaterede registreringer ikke tælles med i "denne
 * måned" — samme regel som månedsbudgettet. null for "alt".
 */
export function periodEndUtc(period: PeriodKey, now = new Date()): Date | null {
  const from = periodStartUtc(period, now);
  if (!from) return null;
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  switch (period) {
    case "week":
      return new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(Date.UTC(y, m + 1, 1));
    case "quarter":
      return new Date(Date.UTC(y, m + 3, 1));
    case "year":
      return new Date(Date.UTC(y + 1, 0, 1));
    default:
      return null;
  }
}
