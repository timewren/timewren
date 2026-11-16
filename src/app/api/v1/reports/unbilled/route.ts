import type { NextRequest } from "next/server";
import {
  authenticateApiKey,
  corsPreflightResponse,
  handleTrpcError,
  requireScope,
  successResponse,
  withRateLimitHeaders,
} from "@/lib/api/middleware";

// GET /api/v1/reports/unbilled — unbilled (billable, not yet invoiced) hours
// and amount, grouped by client. Saves callers from fetching every entry and
// aggregating client-side.
//
// Svarets form er uændret. Tallene kan derimod flytte sig (#626): ruten
// aggregerede tidligere `time.list` i hukommelsen, hvilket både brugte et
// andet filter end resten af appen (`isBillable` strengt true, så gamle
// NULL-rækker faldt ud) og tavst stoppede ved listens default-limit på 100
// rækker. Den bruger nu den fælles definition fra
// src/lib/invoicing/unbilled.ts og aggregerer i SQL uden loft.
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.context, "reports", "read");
  if (scopeErr) return scopeErr;

  try {
    const groups = await auth.context.caller.time.unbilledByClient();

    let totalHours = 0;
    let totalAmount = 0;
    for (const g of groups) {
      totalHours += g.hours;
      totalAmount += g.value;
    }

    const byClient = groups.map((g) => ({
      clientId: g.clientId,
      clientName: g.clientName,
      hours: g.hours.toFixed(2),
      amount: g.value.toFixed(2),
      entryCount: g.entryCount,
    }));

    return withRateLimitHeaders(
      successResponse({
        totalHours: totalHours.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        byClient,
      }),
      auth.context.rateLimit,
    );
  } catch (error) {
    return handleTrpcError(error);
  }
}

export function OPTIONS() {
  return corsPreflightResponse();
}
