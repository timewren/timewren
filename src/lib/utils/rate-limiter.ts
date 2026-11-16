/**
 * Rate Limiter
 *
 * Vælger backend via RATE_LIMIT_BACKEND:
 *  - "valkey": delt på tværs af replicas (atomisk INCR+PEXPIRE i Valkey).
 *  - andet/unset: per-proces in-memory sliding window (fallback).
 * Ved enhver Valkey-fejl falder den tilbage til in-memory — aldrig en blokeret
 * request pga. infrastrukturfejl.
 */

import { getReadyValkey } from "@/lib/valkey";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export const RATE_LIMIT_CONFIGS = {
  ai: { maxRequests: 20, windowMs: 60 * 1000 },
  aiPrioritize: { maxRequests: 5, windowMs: 60 * 1000 },
  login: { maxRequests: 5, windowMs: 15 * 60 * 1000 },
  portalLogin: { maxRequests: 5, windowMs: 15 * 60 * 1000 },
  signup: { maxRequests: 3, windowMs: 60 * 60 * 1000 },
  betaSignup: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
  api: { maxRequests: 300, windowMs: 60 * 1000 },
  apiAuth: { maxRequests: 300, windowMs: 60 * 1000 },
  // MCP-værktøjskald pr. nøgle/forbundet AI-app og bruger (#912)
  mcp: { maxRequests: 120, windowMs: 60 * 1000 },
  cvr: { maxRequests: 10, windowMs: 60 * 1000 },
  // Navneforslag mens man skriver (desktops kundeformular): flere kald pr. minut
  cvrSuggest: { maxRequests: 30, windowMs: 60 * 1000 },
  email: { maxRequests: 20, windowMs: 60 * 60 * 1000 },
  contact: { maxRequests: 3, windowMs: 60 * 60 * 1000 },
  // Lead-capture på gratis værktøjer ("få guiden på mail")
  lead: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
  extensionToken: { maxRequests: 10, windowMs: 15 * 60 * 1000 },
  // Per-token cap on extension write/mutation calls. Generous enough for
  // normal use (manual entries, timer start/stop, auto-tracking bursts) while
  // stopping a leaked token from flooding the DB.
  extensionWrite: { maxRequests: 120, windowMs: 60 * 1000 },
  webhookTest: { maxRequests: 5, windowMs: 60_000 },
  // Sentry-autofix: hård kappe på hvor mange agent-kørsler ét webhook kan
  // udløse. Delt på tværs af replicas når Valkey er slået til.
  sentryAutofix: { maxRequests: 10, windowMs: 60 * 60 * 1000 },
  supporterPasswordReset: { maxRequests: 3, windowMs: 60 * 60 * 1000 },
  reportExport: { maxRequests: 20, windowMs: 60 * 1000 },
  // Billed-uploads pr. bruger: hver upload buffes og dekodes af sharp (#1117)
  upload: { maxRequests: 30, windowMs: 60 * 1000 },
  feedback: { maxRequests: 10, windowMs: 60 * 60 * 1000 },
  // Anonym feedback fra appen uden konto — pr. installation og pr. IP
  feedbackAnon: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
  // Databehandleraftalen som PDF: den generelle er cachet og billig (pr. IP),
  // den udfyldte renderes pr. forespørgsel (pr. bruger).
  dpaPdf: { maxRequests: 30, windowMs: 60 * 60 * 1000 },
  dpaPdfFilled: { maxRequests: 20, windowMs: 60 * 60 * 1000 },
  // CSP-rapporter fra browseren (report-only, #1121): offentlig rute uden
  // login. Én side kan give flere rapporter, men ikke hundredvis pr. minut.
  cspReport: { maxRequests: 60, windowMs: 60 * 1000 },
  // Fakturamails via REST pr. organisation (ellers pr. bruger), #1142.
  // Rummer en månedsafslutning med mange fakturaer, stopper et loop.
  invoiceSend: { maxRequests: 60, windowMs: 60 * 60 * 1000 },
  // Desktop-licens uden login (#1103): verify/deactivate pr. IP, så nøgler
  // ikke kan afprøves i bulk; køb og refusion er sjældne handlinger.
  desktopLicense: { maxRequests: 30, windowMs: 60 * 1000 },
  desktopCheckout: { maxRequests: 10, windowMs: 60 * 60 * 1000 },
  desktopRefund: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
} as const;

type RateLimitType = keyof typeof RATE_LIMIT_CONFIGS;

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

/** Custom error for rate limiting */
export class RateLimitError extends Error {
  public readonly resetIn: number;
  public readonly code = "RATE_LIMIT_EXCEEDED";

  constructor(message: string, resetIn: number) {
    super(message);
    this.name = "RateLimitError";
    this.resetIn = resetIn;
  }
}

/** In-memory sliding window (per-process fallback). */
class InMemoryRateLimiter {
  private limits = new Map<string, RateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof setInterval !== "undefined") {
      this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
      // Don't keep the event loop alive just for cleanup.
      (this.cleanupInterval as { unref?: () => void }).unref?.();
    }
  }

  check(key: string, config: RateLimitConfig): RateLimitResult {
    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || now >= entry.resetAt) {
      this.limits.set(key, { count: 1, resetAt: now + config.windowMs });
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetIn: config.windowMs,
      };
    }
    if (entry.count >= config.maxRequests) {
      return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
    }
    entry.count++;
    return {
      allowed: true,
      remaining: config.maxRequests - entry.count,
      resetIn: entry.resetAt - now,
    };
  }

  reset(key: string): void {
    this.limits.delete(key);
  }

  getUsage(
    key: string,
    type: RateLimitType,
  ): { count: number; max: number; resetAt: number | null } {
    const config = RATE_LIMIT_CONFIGS[type];
    const entry = this.limits.get(key);
    if (!entry || Date.now() >= entry.resetAt) {
      return { count: 0, max: config.maxRequests, resetAt: null };
    }
    return {
      count: entry.count,
      max: config.maxRequests,
      resetAt: entry.resetAt,
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.limits.entries()) {
      if (now >= entry.resetAt) this.limits.delete(key);
    }
  }
}

// Atomisk: INCR, sæt udløb kun på første hit, returnér [count, pttl_ms].
const INCR_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}
`;

class RateLimiter {
  private memory = new InMemoryRateLimiter();

  /** Valkey kun når backenden er valgt og forbindelsen er klar; ellers in-memory. */
  private readyValkey() {
    if (process.env.RATE_LIMIT_BACKEND !== "valkey") return null;
    return getReadyValkey();
  }

  async check(key: string, type: RateLimitType): Promise<RateLimitResult> {
    return this.checkLimit(key, RATE_LIMIT_CONFIGS[type]);
  }

  /** Som check(), men med en grænse der ikke står i RATE_LIMIT_CONFIGS. */
  async checkLimit(
    key: string,
    config: RateLimitConfig,
  ): Promise<RateLimitResult> {
    const client = this.readyValkey();
    if (client) {
      try {
        const result = (await client.eval(
          INCR_SCRIPT,
          1,
          `rl:${key}`,
          String(config.windowMs),
        )) as [number, number];
        const count = result[0];
        const pttl = result[1];
        const resetIn = pttl > 0 ? pttl : config.windowMs;
        if (count > config.maxRequests) {
          return { allowed: false, remaining: 0, resetIn };
        }
        return {
          allowed: true,
          remaining: Math.max(0, config.maxRequests - count),
          resetIn,
        };
      } catch (err) {
        console.error("[rate-limit] Valkey-fejl, falder til in-memory:", err);
        // fall through to in-memory
      }
    }

    return this.memory.check(key, config);
  }

  async checkOrThrow(key: string, type: RateLimitType): Promise<void> {
    const result = await this.check(key, type);
    if (!result.allowed) {
      const resetInSeconds = Math.ceil(result.resetIn / 1000);
      throw new RateLimitError(
        `For mange forespørgsler. Prøv igen om ${resetInSeconds} sekunder.`,
        result.resetIn,
      );
    }
  }

  async reset(key: string): Promise<void> {
    const client = this.readyValkey();
    if (client) {
      try {
        await client.del(`rl:${key}`);
      } catch (err) {
        console.error("[rate-limit] Valkey reset-fejl:", err);
      }
    }
    this.memory.reset(key);
  }

  async getUsage(
    key: string,
    type: RateLimitType,
  ): Promise<{ count: number; max: number; resetAt: number | null }> {
    const config = RATE_LIMIT_CONFIGS[type];
    const client = this.readyValkey();
    if (client) {
      try {
        const [countStr, pttl] = await Promise.all([
          client.get(`rl:${key}`),
          client.pttl(`rl:${key}`),
        ]);
        const count = countStr ? Number.parseInt(countStr, 10) : 0;
        return {
          count,
          max: config.maxRequests,
          resetAt: pttl > 0 ? Date.now() + pttl : null,
        };
      } catch (err) {
        console.error("[rate-limit] Valkey getUsage-fejl:", err);
      }
    }
    return this.memory.getUsage(key, type);
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

/** Create a rate limit key for a user */
export function userRateLimitKey(userId: string, endpoint: string): string {
  return `user:${userId}:${endpoint}`;
}

/** Create a rate limit key for an IP address */
export function ipRateLimitKey(ip: string, endpoint: string): string {
  return `ip:${ip}:${endpoint}`;
}

/**
 * Get client IP from request headers.
 *
 * SECURITY: Uses the RIGHTMOST value in X-Forwarded-For (appended by our
 * trusted reverse proxy), not the leftmost (user-controlled, spoofable).
 */
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
