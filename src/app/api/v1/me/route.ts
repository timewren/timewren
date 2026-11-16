import type { NextRequest } from "next/server";
import {
  authenticateApiKey,
  corsPreflightResponse,
  handleTrpcError,
  successResponse,
  withRateLimitHeaders,
} from "@/lib/api/middleware";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("error" in auth) return auth.error;

  // No specific scope required — any valid API key can check its own identity

  try {
    const profile = await auth.context.caller.user.getProfile();

    if (!profile) {
      return withRateLimitHeaders(
        successResponse({
          id: auth.context.userId,
          scopes: auth.context.scopes,
          apiKeyId: auth.context.apiKeyId,
        }),
        auth.context.rateLimit,
      );
    }

    // Return safe subset of user profile + API key info
    const data = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      image: profile.image,
      defaultHourlyRate: profile.defaultHourlyRate,
      timezone: profile.timezone,
      workingHoursStart: profile.workingHoursStart,
      workingHoursEnd: profile.workingHoursEnd,
      weeklyHourGoal: profile.weeklyHourGoal,
      createdAt: profile.createdAt,
      apiKey: {
        id: auth.context.apiKeyId,
        scopes: auth.context.scopes,
      },
    };

    return withRateLimitHeaders(successResponse(data), auth.context.rateLimit);
  } catch (error) {
    return handleTrpcError(error);
  }
}

export function OPTIONS() {
  return corsPreflightResponse();
}
