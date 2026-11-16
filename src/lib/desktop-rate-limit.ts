/**
 * Rate limiter for desktop- og extension-endpoints (per IP/nøgle).
 * Tæller via den fælles rateLimiter: i Valkey (delt på tværs af replicas)
 * når RATE_LIMIT_BACKEND=valkey, ellers in-memory i processen.
 */

import {
  getClientIp as getClientIpFromHeaders,
  rateLimiter,
} from "@/lib/utils/rate-limiter";

/**
 * Check if a request is within the rate limit.
 *
 * @param ip - Client IP address
 * @param limit - Max requests per window
 * @param windowMs - Window duration in milliseconds
 * @returns true if allowed, false if rate-limited
 */
export async function checkRateLimit(
  ip: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const result = await rateLimiter.checkLimit(`desktop:${ip}`, {
    maxRequests: limit,
    windowMs,
  });
  return result.allowed;
}

/**
 * Return a 429 Response for rate-limited requests.
 */
export function rateLimitResponse() {
  return new Response(
    JSON.stringify({
      error: "For mange forespørgsler. Prøv igen senere.",
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "60",
      },
    },
  );
}

/**
 * Extract client IP from request headers. Samme regel som den fælles
 * rateLimiter: det yderste højre X-Forwarded-For-hop (sat af vores proxy),
 * aldrig klientens egen venstre værdi.
 */
export function getClientIp(request: Request): string {
  return getClientIpFromHeaders(request.headers);
}
