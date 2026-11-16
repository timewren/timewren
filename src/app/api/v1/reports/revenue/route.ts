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

    const rawGroupBy = params.get("groupBy") || "client";
    if (rawGroupBy !== "client" && rawGroupBy !== "project") {
      return errorResponse(
        400,
        "BAD_REQUEST",
        "groupBy must be 'client' or 'project'",
      );
    }
    const groupBy = rawGroupBy as "client" | "project";
    const clientId = params.get("clientId") || undefined;

    const result = await auth.context.caller.reports.getReportData({
      config: {
        audience: "internal",
        filters: {
          dateRange: "custom",
          customStart: startDate,
          customEnd: endDate,
          clientIds: clientId ? [clientId] : [],
          projectIds: [],
          memberIds: [],
          tagIds: [],
          billable: "all",
          billedStatus: "all",
          includePrepaid: true,
        },
        grouping: groupBy,
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

    const breakdown = result.aggregates.groups.map((g) => {
      if (groupBy === "project") {
        const firstEntry = g.entries[0];
        return {
          projectId: g.key,
          projectName: g.label,
          clientName:
            firstEntry?.client?.name ?? firstEntry?.project?.client?.name ?? "",
          hours: g.hours.toFixed(2),
          revenue: g.revenue.toFixed(2),
        };
      }
      return {
        clientId: g.key,
        clientName: g.label,
        hours: g.hours.toFixed(2),
        revenue: g.revenue.toFixed(2),
      };
    });

    return withRateLimitHeaders(
      successResponse({ groupBy, breakdown }),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export function OPTIONS() {
  return corsPreflightResponse();
}
