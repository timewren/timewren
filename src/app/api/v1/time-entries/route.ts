import type { NextRequest } from "next/server";
import {
  authenticateApiKey,
  corsPreflightResponse,
  errorResponse,
  handleTrpcError,
  paginatedResponse,
  parsePagination,
  parseSorting,
  requireScope,
  successResponse,
  withRateLimitHeaders,
} from "@/lib/api/middleware";
import {
  parsePrepaidMode,
  resolveAutoPrepaidPackageId,
} from "@/lib/api/prepaid-auto";
import {
  normalizeBillableRate,
  toTimeListQuery,
} from "@/lib/api/time-entry-input";

// GET /api/v1/time-entries — list time entries
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "time", "read");
  if (scopeErr) return scopeErr;

  const params = request.nextUrl.searchParams;

  const projectId = params.get("projectId") ?? undefined;
  const clientId = params.get("clientId") ?? undefined;
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  const isBillableParam = params.get("isBillable");
  const isBilledParam = params.get("isBilled");

  let isBillable: boolean | undefined;
  if (isBillableParam !== null) {
    if (isBillableParam === "true") isBillable = true;
    else if (isBillableParam === "false") isBillable = false;
    else {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "isBillable must be 'true' or 'false'",
      );
    }
  }

  let isBilled: boolean | undefined;
  if (isBilledParam !== null) {
    if (isBilledParam === "true") isBilled = true;
    else if (isBilledParam === "false") isBilled = false;
    else {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "isBilled must be 'true' or 'false'",
      );
    }
  }

  const pagination = parsePagination(params);
  if ("error" in pagination) return pagination.error;
  const { page, limit } = pagination;
  const { sort, order } = parseSorting(params, ["createdAt", "date", "hours"]);

  try {
    // Pagineringen skal ske i databasen. Tidligere blev der hentet uden
    // limit, hvilket ramte procedurens egen default på 100 rækker — så
    // svaret stoppede ved post nummer 100, `total` sagde 100, og der fandtes
    // ingen side at hente resten fra. Et bredt udtræk mistede tavst alt
    // derudover.
    const result = await auth.context.caller.time.list({
      projectId,
      clientId,
      startDate: from,
      endDate: to,
      isBillable,
      isBilled,
      ...toTimeListQuery(page, limit, sort, order),
    });

    return withRateLimitHeaders(
      paginatedResponse(result.entries, page, limit, result.total ?? 0),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

// POST /api/v1/time-entries — create a time entry
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "time", "write");
  if (scopeErr) return scopeErr;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (typeof body !== "object" || body === null) {
    return errorResponse(400, "BAD_REQUEST", "Request body must be an object");
  }

  const {
    projectId,
    clientId,
    description,
    notes,
    hours,
    date,
    startTime,
    endTime,
    isBillable,
    isBilled,
    taskId,
    billableRate,
    prepaidPackageId,
    prepaidHoursOverride,
  } = body as Record<string, unknown>;

  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) {
    return errorResponse(
      400,
      "BAD_REQUEST",
      "hours must be a positive finite number",
    );
  }

  if (typeof date !== "string" || !date) {
    return errorResponse(400, "BAD_REQUEST", "date is required (YYYY-MM-DD)");
  }

  const prepaidMode = parsePrepaidMode(body as Record<string, unknown>);
  if (!prepaidMode.ok) {
    return errorResponse(400, "BAD_REQUEST", prepaidMode.message, [
      { field: prepaidMode.field, message: prepaidMode.message },
    ]);
  }

  try {
    // `prepaid: "auto"` (#422): udløber-først-reglen vælger kundens kort —
    // samme regel som web og extension. Intet kort = ingen træk.
    const resolvedPackageId = prepaidMode.auto
      ? await resolveAutoPrepaidPackageId(auth.context.caller, {
          clientId: typeof clientId === "string" ? clientId : null,
          projectId: typeof projectId === "string" ? projectId : null,
        })
      : typeof prepaidPackageId === "string"
        ? prepaidPackageId
        : undefined;

    const entry = await auth.context.caller.time.create({
      projectId: typeof projectId === "string" ? projectId : undefined,
      clientId: typeof clientId === "string" ? clientId : undefined,
      description: typeof description === "string" ? description : "",
      notes: typeof notes === "string" ? notes : undefined,
      hours,
      date,
      startTime: typeof startTime === "string" ? startTime : undefined,
      endTime: typeof endTime === "string" ? endTime : undefined,
      isBillable: typeof isBillable === "boolean" ? isBillable : undefined,
      isBilled: typeof isBilled === "boolean" ? isBilled : undefined,
      taskId: typeof taskId === "string" ? taskId : undefined,
      // En sats er et beløb, så klienter sender naturligt et tal. Tidligere
      // blev tal kasseret tavst, og posten fik klientens sats i stedet.
      billableRate: normalizeBillableRate(billableRate),
      prepaidPackageId: resolvedPackageId ?? undefined,
      prepaidHoursOverride:
        typeof prepaidHoursOverride === "number"
          ? prepaidHoursOverride
          : undefined,
    });
    // Mutationen returnerer kun de rå kolonner, så en oprettet post så ud som
    // om den manglede klient og projekt. Læs den tilbage med relationerne
    // foldet ud, men behold klippekort-trækket og compliance-advarslerne fra
    // oprettelsen — de findes ikke på posten selv. Slår opslaget fejl, er
    // posten stadig oprettet, og vi svarer med det vi har.
    let payload: unknown = entry;
    try {
      const full = await auth.context.caller.time.getById({ id: entry.id });
      payload = {
        ...full,
        prepaidDeduction: entry.prepaidDeduction,
        complianceWarnings: entry.complianceWarnings,
      };
    } catch {
      payload = entry;
    }

    return withRateLimitHeaders(
      successResponse(payload, 201),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export function OPTIONS() {
  return corsPreflightResponse();
}
