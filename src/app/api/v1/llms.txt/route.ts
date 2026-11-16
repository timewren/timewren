// GET /api/v1/llms.txt — concise, machine-readable orientation for AI agents.
// Public (no auth) so an agent can read it before authenticating.

const LLMS_TXT = `# TimeTrack API: guide for AI agents

TimeTrack is Danish time tracking with prepaid hour packages (klippekort) for
freelancers and small agencies. Resources:
clients, projects, time entries, invoices, prepaid hour packages (klippekort),
and tasks.

## Base URL
https://timetrack.dk/api/v1

## Authentication
All endpoints except this one require a Bearer API key:
  Authorization: Bearer tk_live_xxxxx
Get key info and scopes from GET /me. Full machine-readable schema:
GET /api/v1/openapi.json (OpenAPI 3.1).

## Conventions
- Responses are JSON: { "data": ... } or { "data": [...], "pagination": {...} }.
- Errors: { "error": { "code", "message", "details"? } } with an HTTP status.
- Money and rates are decimal strings (e.g. "850.00"). Dates are YYYY-MM-DD.
- Pagination: ?page=1&limit=25 (max 100); keep fetching while pagination.hasMore is true (pagination.nextPage). Rate limit: 300 req/min per key
  (X-RateLimit-* + Retry-After headers on 429).

## Core resources
GET/POST    /clients            list/create clients (rate = defaultHourlyRate)
GET/POST    /projects           list/create projects (rate = hourlyRate)
GET/POST    /time-entries       list/create time entries
PATCH/DELETE /time-entries/{id} update/delete (partial update)
POST        /time-entries/batch import | delete | markBilled (bulk)
GET/POST    /invoices           list/create invoices
POST        /invoices/from-time-entries   generate a draft invoice from entries
POST        /invoices/{id}/send  email an invoice
GET         /reports/unbilled    unbilled hours+amount per client
GET         /reports/revenue     revenue breakdown

## Time entry filters (GET /time-entries)
clientId, projectId, from, to (YYYY-MM-DD), isBillable, isBilled, page, limit.
A time entry's billableRate is stamped from the rate hierarchy
(member > project > client > user) at create/update time, resolved for the
entry's OWN date: scheduled rate changes apply by date, so time logged
retroactively gets the rate that applied on that day. You can override it by
sending billableRate explicitly.

## Scheduled rate changes (raise a client's rate from a date)
GET    /rate-changes?clientId=|projectId=   planned changes (includeInactive=true for all)
POST   /rate-changes    { "clientId": "<id>", "newRate": "800", "effectiveDate": "2026-11-01" }
DELETE /rate-changes/{id}                   cancel a planned change
Entries dated before effectiveDate keep the old rate, entries on/after get the
new one. Unbilled entries dated on/after effectiveDate are re-stamped at once
(manually overridden rates are left alone); the client's current rate switches
on effectiveDate via a daily job.

## Common workflow: invoice a client's outstanding time
1. GET /reports/unbilled                     -> see who has billable time
2. POST /invoices/from-time-entries
   { "clientId": "<id>", "dryRun": true }     -> PREVIEW line items + total
3. POST /invoices/from-time-entries
   { "clientId": "<id>" }                     -> create the draft (marks billed)
4. POST /invoices/{id}/send                   -> email it (irreversible)
Omit timeEntryIds to auto-select all unbilled billable entries for the client.

## Notes for agents
- Use ?dryRun=true on /invoices/from-time-entries to show the result before
  committing. Sending an invoice (step 4) is outward-facing and hard to undo.
  Confirm with the human first.
- To change a client's rate from a date, POST /rate-changes (re-stamps
  unbilled entries from that date). Setting only the client's defaultHourlyRate
  does not re-stamp existing entries; to change a single entry, PATCH it or
  send billableRate.
`;

export async function GET() {
  return new Response(LLMS_TXT, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
