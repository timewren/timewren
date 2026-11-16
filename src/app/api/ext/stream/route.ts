import { TRPCError } from "@trpc/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  addTimerListener,
  getRealtimeStatus,
  orgChannel,
  userChannel,
} from "@/lib/realtime";
import {
  formatDeviceStreamFrame,
  toDeviceStreamEvent,
} from "@/lib/realtime-device";
import {
  formatPingFrame,
  REALTIME_PING_INTERVAL_MS,
} from "@/lib/realtime-ping";
import {
  authenticateDeviceToken,
  authenticateDeviceTokenById,
} from "@/lib/trpc/routers/ext/device-procedure";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";

// SSE needs a long-lived Node response, never cached or statically rendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ext/stream — live-hændelser til token-klienter (desktop 1.0,
 * udvidelsen, mobilen).
 *
 * Auth: `Authorization: Bearer <extension-token>`. Org: `?organizationId=`
 * (skal være en org, brugeren er medlem af; ellers primær-orgen).
 *
 * Hændelser (kun type/version, ingen forretningsdata — klienten henter
 * selv): `timer` ({event, version}) og `data` ({entities: [...]}) når
 * timer, poster, kunder, projekter, klippekort, fakturaer eller opgaver
 * ændres i brugerens org. `ping` hvert 25. s holder Traefik/Cloudflare
 * åbne og lader klienten opdage en død strøm. Bliver tokenet tilbagekaldt,
 * sendes `revoked`, og strømmen lukkes. 503 = realtime slået fra; klienten
 * poller i stedet.
 */
export async function GET(request: NextRequest) {
  if (process.env.REALTIME_ENABLED !== "true") {
    return new Response("realtime disabled", { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const requestedOrgId =
    request.nextUrl.searchParams.get("organizationId") || null;

  let auth: Awaited<ReturnType<typeof authenticateDeviceToken>>;
  try {
    if (!token) throw new TRPCError({ code: "UNAUTHORIZED" });
    auth = await authenticateDeviceToken(db, token, requestedOrgId);
  } catch (err) {
    const code = err instanceof TRPCError ? err.code : "INTERNAL_SERVER_ERROR";
    if (code === "UNAUTHORIZED") {
      // Mislykkede forsøg tæller mod IP'ens budget (som validateToken).
      const limit = await rateLimiter.check(
        ipRateLimitKey(getClientIp(request.headers), "ext.stream"),
        "extensionToken",
      );
      return new Response("unauthorized", {
        status: limit.allowed ? 401 : 429,
      });
    }
    if (code === "FORBIDDEN") {
      return new Response("forbidden", { status: 403 });
    }
    throw err;
  }

  const channels = [userChannel(auth.userId)];
  if (auth.orgId) channels.push(orgChannel(auth.orgId));

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let seq = 0;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed — ignore.
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      send(": connected\n\n");

      unsubscribe = addTimerListener(channels, (channel, message) => {
        const event = toDeviceStreamEvent(channel, message);
        if (event) send(formatDeviceStreamFrame(++seq, event));
      });

      // Ping + tjek af at tokenet stadig er gyldigt (tilbagekaldt i web).
      // Tjekket følger tokenrækken, ikke tokenstrengen: en fornyelse
      // roterer strengen, men er ikke en tilbagekaldelse.
      const tick = async () => {
        try {
          await authenticateDeviceTokenById(db, auth.tokenId, auth.orgId, {
            recordUse: false,
          });
        } catch (err) {
          if (err instanceof TRPCError) {
            send("event: revoked\ndata: {}\n\n");
            close();
            return;
          }
          // DB-fejl: behold strømmen; næste tick prøver igen.
        }
        send(formatPingFrame(Date.now(), getRealtimeStatus().subscribed));
      };
      send(formatPingFrame(Date.now(), getRealtimeStatus().subscribed));
      heartbeat = setInterval(() => void tick(), REALTIME_PING_INTERVAL_MS);

      request.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering so events flush immediately through Traefik.
      "X-Accel-Buffering": "no",
    },
  });
}
