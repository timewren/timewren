/**
 * `time.list({ view: "summary" })`: the related rows trimmed to the columns
 * the web UI reads, instead of every column of project, the project's client,
 * the client and the klippekort for each entry. With full rows those
 * relations were two thirds of the response, about 3.5 KB per entry, so the
 * client page's 1,000 entries came to several MB
 * (docs/research/2026-11-22-stabilitet.md).
 *
 * The default view is unchanged: REST v1, MCP, the browser extension and
 * the mobile app get the full rows. Web callers use `useTimeListSummary`
 * (src/hooks/useTimeListSummary.ts), whose type only has these columns, so
 * reading anything else fails in tsc instead of being silently undefined.
 *
 * The rounding columns must stay: time.list computes `roundedHours` from
 * the client's and project's rounding settings.
 */
const ROUNDING = {
  roundingEnabled: true,
  roundingMinutes: true,
  roundingMethod: true,
} as const;

export const TIME_LIST_SUMMARY_COLUMNS = {
  project: {
    id: true,
    name: true,
    clientId: true,
    hourlyRate: true,
    status: true,
    ...ROUNDING,
  },
  client: {
    id: true,
    name: true,
    company: true,
    color: true,
    defaultHourlyRate: true,
    ...ROUNDING,
  },
  prepaidPackage: {
    id: true,
    name: true,
  },
} as const;

export type TimeListView = "full" | "summary";
