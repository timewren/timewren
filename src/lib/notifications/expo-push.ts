import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { mobilePushTokens } from "@/lib/db/schema";

/**
 * Expo Push Service — native push til mobilappen (iOS/Android).
 *
 * Ingen SDK-afhængighed: HTTP-API'et er trivielt (POST JSON, maks 100
 * beskeder pr. request). EXPO_ACCESS_TOKEN er valgfrit; sættes det i Expo-
 * dashboardet ("Enhanced push security") skal det også sættes her.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_PUSH_CHUNK_SIZE = 100;

export interface ExpoPushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  badge?: number;
  sound?: "default" | null;
}

export interface ExpoPushResult {
  /** Antal tokens der blev forsøgt sendt til (efter filtrering af ugyldige). */
  attempted: number;
  /** Antal tickets Expo kvitterede med status "ok". */
  sent: number;
  /** Tokens Expo meldte DeviceNotRegistered for — deaktiveret i DB. */
  deactivated: string[];
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string; expoPushToken?: string };
}

/** Expo-tokens har altid formen ExponentPushToken[xxx] eller ExpoPushToken[xxx]. */
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Send én besked til en liste af Expo-tokens. Kaster aldrig — leverancen må
 * ikke vælte den handling der udløste den. Tokens Expo melder som
 * DeviceNotRegistered sættes isActive=false så de ikke prøves igen.
 */
export async function sendExpoPush(
  tokens: string[],
  payload: ExpoPushPayload,
): Promise<ExpoPushResult> {
  const valid = Array.from(new Set(tokens.filter(isExpoPushToken)));
  const result: ExpoPushResult = {
    attempted: valid.length,
    sent: 0,
    deactivated: [],
  };
  if (valid.length === 0) return result;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const message = {
    title: payload.title,
    body: payload.body,
    data: payload.data,
    badge: payload.badge,
    sound: payload.sound === undefined ? "default" : payload.sound,
  };

  for (const batch of chunk(valid, EXPO_PUSH_CHUNK_SIZE)) {
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(batch.map((to) => ({ to, ...message }))),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.error(
          `[expo-push] HTTP ${res.status} fra Expo Push Service (${batch.length} tokens)`,
        );
        continue;
      }
      const json = (await res.json()) as { data?: ExpoPushTicket[] };
      const tickets = json.data ?? [];
      // Tickets kommer i samme rækkefølge som beskederne.
      tickets.forEach((ticket, i) => {
        if (ticket.status === "ok") {
          result.sent++;
          return;
        }
        if (ticket.details?.error === "DeviceNotRegistered") {
          const token = ticket.details.expoPushToken ?? batch[i];
          if (token) result.deactivated.push(token);
        } else {
          console.warn(
            `[expo-push] Ticket-fejl ${ticket.details?.error ?? "ukendt"}: ${ticket.message ?? ""}`,
          );
        }
      });
    } catch (err) {
      console.error("[expo-push] Netværksfejl mod Expo Push Service:", err);
    }
  }

  if (result.deactivated.length > 0) {
    try {
      await db
        .update(mobilePushTokens)
        .set({ isActive: false, updatedAt: new Date() })
        .where(inArray(mobilePushTokens.token, result.deactivated));
    } catch (err) {
      console.error("[expo-push] Kunne ikke deaktivere tokens:", err);
    }
  }

  return result;
}
