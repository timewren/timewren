/**
 * Plausible Analytics API v1 client (server-only)
 * Uses v1 Stats API which is supported by all Plausible versions (cloud + self-hosted)
 * Docs: https://plausible.io/docs/stats-api
 */

const PLAUSIBLE_API_KEY = process.env.PLAUSIBLE_API_KEY;
const PLAUSIBLE_BASE_URL =
  process.env.PLAUSIBLE_BASE_URL || "https://plausible.io";
const PLAUSIBLE_SITE_ID = process.env.PLAUSIBLE_SITE_ID;

export function isPlausibleConfigured(): boolean {
  return !!(PLAUSIBLE_API_KEY && PLAUSIBLE_SITE_ID);
}

const headers = () => ({
  Authorization: `Bearer ${PLAUSIBLE_API_KEY}`,
  "Content-Type": "application/json",
});

function buildUrl(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${PLAUSIBLE_BASE_URL}${path}`);
  url.searchParams.set("site_id", PLAUSIBLE_SITE_ID ?? "");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function fetchPlausible<T>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  if (!PLAUSIBLE_API_KEY || !PLAUSIBLE_SITE_ID) {
    throw new Error("Plausible is not configured");
  }

  const url = buildUrl(path, params);
  const response = await fetch(url, {
    headers: headers(),
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Plausible API error ${response.status}: ${text}`);
  }

  return response.json();
}

// Get realtime visitors count
export async function getRealtimeVisitors(): Promise<number> {
  if (!PLAUSIBLE_API_KEY || !PLAUSIBLE_SITE_ID) return 0;

  try {
    const url = buildUrl("/api/v1/stats/realtime/visitors", {});
    const response = await fetch(url, {
      headers: headers(),
      next: { revalidate: 15 },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return 0;
    return response.json();
  } catch {
    return 0;
  }
}

// v1 aggregate response format
interface AggregateResult {
  results: Record<string, { value: number }>;
}

// Aggregate stats for a date range
export async function getAggregateStats(dateRange: string) {
  const data = await fetchPlausible<AggregateResult>(
    "/api/v1/stats/aggregate",
    {
      period: dateRange,
      metrics: "visitors,pageviews,bounce_rate,visit_duration,visits",
    },
  );

  return {
    visitors: data.results.visitors?.value ?? 0,
    pageviews: data.results.pageviews?.value ?? 0,
    bounceRate: data.results.bounce_rate?.value ?? 0,
    visitDuration: data.results.visit_duration?.value ?? 0,
    visits: data.results.visits?.value ?? 0,
  };
}

// v1 timeseries response format
interface TimeseriesResult {
  results: Array<{
    date: string;
    visitors: number;
    pageviews: number;
  }>;
}

// Visitor timeseries
export async function getVisitorTimeseries(dateRange: string) {
  const data = await fetchPlausible<TimeseriesResult>(
    "/api/v1/stats/timeseries",
    {
      period: dateRange,
      metrics: "visitors,pageviews",
    },
  );

  return data.results.map((r) => ({
    date: r.date,
    visitors: r.visitors,
    pageviews: r.pageviews,
  }));
}

// v1 breakdown response format
interface BreakdownResult {
  results: Array<Record<string, string | number>>;
}

// Top pages
export async function getTopPages(dateRange: string, limit = 10) {
  const data = await fetchPlausible<BreakdownResult>(
    "/api/v1/stats/breakdown",
    {
      period: dateRange,
      property: "event:page",
      metrics: "visitors,pageviews",
      limit,
    },
  );

  return data.results.map((r) => ({
    page: String(r.page || ""),
    visitors: Number(r.visitors || 0),
    pageviews: Number(r.pageviews || 0),
  }));
}

// Traffic sources
export async function getTrafficSources(dateRange: string, limit = 10) {
  const data = await fetchPlausible<BreakdownResult>(
    "/api/v1/stats/breakdown",
    {
      period: dateRange,
      property: "visit:source",
      metrics: "visitors,visits",
      limit,
    },
  );

  return data.results.map((r) => ({
    source: String(r.source || "Direkte / Ingen"),
    visitors: Number(r.visitors || 0),
    visits: Number(r.visits || 0),
  }));
}

// Device breakdown
export async function getDeviceBreakdown(
  dateRange: string,
  dimension: "device" | "browser" | "os" = "device",
) {
  const propertyMap = {
    device: "visit:device",
    browser: "visit:browser",
    os: "visit:os",
  } as const;

  const data = await fetchPlausible<BreakdownResult>(
    "/api/v1/stats/breakdown",
    {
      period: dateRange,
      property: propertyMap[dimension],
      metrics: "visitors",
      limit: 10,
    },
  );

  return data.results.map((r) => ({
    name: String(r[dimension] || "Ukendt"),
    visitors: Number(r.visitors || 0),
  }));
}

// Country breakdown
export async function getCountryBreakdown(dateRange: string, limit = 10) {
  const data = await fetchPlausible<BreakdownResult>(
    "/api/v1/stats/breakdown",
    {
      period: dateRange,
      property: "visit:country",
      metrics: "visitors",
      limit,
    },
  );

  return data.results.map((r) => ({
    country: String(r.country || "Ukendt"),
    visitors: Number(r.visitors || 0),
  }));
}

// Goal conversions
export async function getGoalConversions(dateRange: string) {
  try {
    const data = await fetchPlausible<BreakdownResult>(
      "/api/v1/stats/breakdown",
      {
        period: dateRange,
        property: "event:name",
        metrics: "visitors,events",
        limit: 20,
      },
    );

    return data.results
      .filter((r) => r.name !== "pageview")
      .map((r) => ({
        goal: String(r.name || ""),
        visitors: Number(r.visitors || 0),
        events: Number(r.events || 0),
      }));
  } catch {
    return [];
  }
}
