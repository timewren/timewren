import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { resolveActiveOrgId } from "@/lib/auth/active-org";
import { db } from "@/lib/db";
import {
  addTimerListener,
  getRealtimeStatus,
  orgChannel,
  sseEventName,
  userChannel,
} from "@/lib/realtime";
import {
  formatPingFrame,
  REALTIME_PING_INTERVAL_MS,
} from "@/lib/realtime-ping";

// SSE needs a long-lived Node response, never cached or statically rendered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Dark by default — only serves when explicitly enabled. Clients fall back
  // to the existing polling sync when this returns non-200.
  if (process.env.REALTIME_ENABLED !== "true") {
    return new Response("realtime disabled", { status: 503 });
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    return new Response("unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const orgId = await resolveActiveOrgId({
    db,
    userId,
    session: session as Record<string, unknown>,
  });

  const channels = [userChannel(userId)];
  if (orgId) channels.push(orgChannel(orgId));

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller already closed — ignore.
        }
      };

      // Initial comment opens the stream; clients ignore comment lines.
      send(": connected\n\n");

      const listener = (channel: string, message: string) => {
        const event = sseEventName(channel, message);
        send(`event: ${event}\ndata: ${message}\n\n`);
      };
      unsubscribe = addTimerListener(channels, listener);

      // Rigtigt ping-event (ikke en kommentar): klientens vagthund ser det
      // og kan opdage en tavs, død strøm. `sub` fortæller om processens
      // Valkey-abonnement er aktivt. Ét straks, så klienten har en basis.
      // Ældre klienter ignorerer det ukendte event-navn.
      const ping = () =>
        send(formatPingFrame(Date.now(), getRealtimeStatus().subscribed));
      ping();
      heartbeat = setInterval(ping, REALTIME_PING_INTERVAL_MS);

      request.signal.addEventListener("abort", () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
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
