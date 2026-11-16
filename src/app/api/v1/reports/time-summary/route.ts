import type { NextRequest } from "next/server";
import {
  authenticateApiKey,
  corsPreflightResponse,
  errorResponse,
  handleTrpcError,
  requireScope,
  successResponse,
  withRateLimitHeaders,
} from "@/lib/api/middleware";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "reports", "read");
  if (scopeErr) return scopeErr;

  try {
    const params = request.nextUrl.searchParams;
    const startDate = params.get("from");
    const endDate = params.get("to");

    if (!startDate || !endDate) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Both 'from' and 'to' query parameters are required (YYYY-MM-DD)",
      );
    }

    const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_REGEX.test(startDate) || !DATE_REGEX.test(endDate)) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "Dates must be in YYYY-MM-DD format",
      );
    }

    if (startDate > endDate) {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "'from' must be before or equal to 'to'",
      );
    }

    const clientId = params.get("clientId") || undefined;
    const projectId = params.get("projectId") || undefined;

    const result = await auth.context.caller.reports.getReportData({
      config: {
        audience: "internal",
        filters: {
          dateRange: "custom",
          customStart: startDate,
          customEnd: endDate,
          clientIds: clientId ? [clientId] : [],
          projectIds: projectId ? [projectId] : [],
          memberIds: [],
          tagIds: [],
          billable: "all",
          billedStatus: "all",
          includePrepaid: true,
        },
        grouping: "none",
        sortBy: "date",
        sortDir: "desc",
        columns: ["date", "client", "project", "hours", "value"],
        branding: {
          showLogo: false,
          primaryColor: "#3b82f6",
          title: "Tidsrapport",
          showSummaryCards: true,
          showClientBreakdown: true,
          showProjectBreakdown: false,
          showEntriesTable: true,
        },
        rounding: "useUserSetting",
      },
    });

    const s = result.aggregates.summary;
    const summary = {
      totalHours: s.totalHours.toFixed(2),
      totalRevenue: s.totalRevenue.toFixed(2),
      billedHours: s.billedHours.toFixed(2),
      unbilledHours: s.unbilledHours.toFixed(2),
      unbilledRevenue: s.unbilledRevenue.toFixed(2),
      entriesCount: s.entriesCount,
    };

    return withRateLimitHeaders(
      successResponse(summary),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export function OPTIONS() {
  return corsPreflightResponse();
}
