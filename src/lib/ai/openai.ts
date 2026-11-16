import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { decryptSecretOrNull } from "@/lib/utils/encryption";

// Default model for cost-effective parsing
export const DEFAULT_MODEL = "gpt-4o-mini";

/** SDK-standarden er 10 minutter; en hængende udbyder må ikke holde en request åben. */
const AI_REQUEST_TIMEOUT_MS = 60_000;

// System-level OpenAI client (lazy-loaded)
let _systemOpenAI: OpenAI | null = null;

function getSystemOpenAI(): OpenAI {
  if (!_systemOpenAI) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("System OPENAI_API_KEY is not configured");
    }
    _systemOpenAI = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: AI_REQUEST_TIMEOUT_MS,
    });
  }
  return _systemOpenAI;
}

// User AI settings cache with LRU eviction to prevent memory leaks
interface UserAISettings {
  aiProvider: string | null;
  aiApiKey: string | null;
  aiApiUrl: string | null;
  aiModel: string | null;
}

interface CacheEntry {
  settings: UserAISettings;
  timestamp: number;
}

// LRU Cache implementation with max size and TTL
class LRUCache<K, V extends { timestamp: number }> {
  private cache = new Map<K, V>();
  private maxSize: number;
  private ttl: number;

  constructor(maxSize: number, ttl: number) {
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  set(key: K, value: V): void {
    // Delete if exists (to refresh position)
    this.cache.delete(key);

    // Evict oldest entries if at max size
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, value);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  // Cleanup expired entries (call periodically)
  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }
}

// Cache with max 1000 entries and 1 minute TTL
const CACHE_MAX_SIZE = 1000;
const CACHE_TTL = 60000; // 1 minute
const userSettingsCache = new LRUCache<string, CacheEntry>(
  CACHE_MAX_SIZE,
  CACHE_TTL,
);

// Periodic cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(
    () => {
      userSettingsCache.cleanup();
    },
    5 * 60 * 1000,
  );
}

async function getUserAISettings(
  userId: string,
): Promise<UserAISettings | null> {
  // Check cache first
  const cached = userSettingsCache.get(userId);
  if (cached) {
    return cached.settings;
  }

  // Fetch from database
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      aiProvider: true,
      aiApiKey: true,
      aiApiUrl: true,
      aiModel: true,
    },
  });

  if (!user) {
    return null;
  }

  const settings: UserAISettings = {
    aiProvider: user.aiProvider,
    // Tåler klartekst-rækker fra før #690 indtil backfill har kørt.
    aiApiKey: decryptSecretOrNull(user.aiApiKey),
    aiApiUrl: user.aiApiUrl,
    aiModel: user.aiModel,
  };

  // Cache the result
  userSettingsCache.set(userId, { settings, timestamp: Date.now() });

  return settings;
}

/**
 * Get OpenAI client for a specific user (BYOK only)
 * Users must configure their own API key in settings.
 */
export async function getOpenAIForUser(
  userId: string,
): Promise<{ client: OpenAI; model: string }> {
  const settings = await getUserAISettings(userId);

  // User must have their own API key configured
  if (
    settings?.aiProvider &&
    settings.aiProvider !== "system" &&
    settings.aiApiKey
  ) {
    const client = new OpenAI({
      apiKey: settings.aiApiKey,
      baseURL: settings.aiApiUrl || undefined,
      timeout: AI_REQUEST_TIMEOUT_MS,
    });

    return {
      client,
      model: settings.aiModel || DEFAULT_MODEL,
    };
  }

  throw new Error(
    "Konfigurer din egen API-nøgle under Indstillinger → AI for at bruge AI-funktioner.",
  );
}

/**
 * Get OpenAI client (system-level, no user context)
 * Use getOpenAIForUser() when you have a user context
 */
export function getOpenAI(): OpenAI {
  return getSystemOpenAI();
}

/**
 * Check if AI is enabled for a specific user (BYOK only)
 */
export async function isAIEnabledForUser(userId: string): Promise<boolean> {
  const settings = await getUserAISettings(userId);
  return !!(
    settings?.aiProvider &&
    settings.aiProvider !== "system" &&
    settings.aiApiKey
  );
}

/**
 * Check if system-level AI is enabled
 */
export function isAIEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Clear user settings cache (call after updating settings)
 */
export function clearUserAICache(userId: string): void {
  userSettingsCache.delete(userId);
}
