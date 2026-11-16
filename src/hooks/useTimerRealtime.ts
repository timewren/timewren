"use client";

import { useEffect, useRef, useState } from "react";
import {
  type DataChangeMessage,
  parseDataChangeMessage,
} from "@/lib/query/cross-tab";
import { evaluateStream, type PingSub, parsePing } from "@/lib/realtime-ping";

// Gated by a public flag so the client only connects when realtime is enabled
// server-side too. Off by default → pure polling (existing behavior).
const REALTIME_ENABLED = process.env.NEXT_PUBLIC_REALTIME_ENABLED === "true";

/** Hvor ofte vagthunden kigger på strømmen. */
const WATCHDOG_TICK_MS = 10_000;

/**
 * Opens an SSE connection to /api/realtime and calls `onTimerPush` whenever a
 * "timer" event for the current user arrives. The push is only a "something
 * changed, check now" signal — the caller reconciles against authoritative
 * server state with its existing logic, so realtime just makes that instant
 * instead of waiting for the next poll. Falls back silently to polling if SSE
 * is disabled, unsupported, or errors.
 *
 * Returns `connected` so the caller can slow its polling backstop while SSE is
 * live. `connected` kræver et frisk signal (ping/besked inden for 60 s) og at
 * serverens Valkey-abonnement er aktivt — ikke bare at "open" er sket. En
 * tavs strøm lukkes og åbnes igen, og ved hver (gen)forbindelse kaldes
 * `onTimerPush`, så hændelser der blev tabt imens, hentes.
 *
 * `onDataChanged` modtager "data"-events (`data_changed`): tidsposter,
 * klippekort eller fakturaer er ændret på en anden enhed, og kalderen
 * invaliderer de nævnte domæner. Samme forbindelse — ingen ekstra EventSource.
 */
export function useTimerRealtime(
  onTimerPush: () => void,
  onDataChanged?: (msg: DataChangeMessage) => void,
): {
  connected: boolean;
} {
  const [connected, setConnected] = useState(false);
  const onPushRef = useRef(onTimerPush);
  onPushRef.current = onTimerPush;
  const onDataRef = useRef(onDataChanged);
  onDataRef.current = onDataChanged;

  useEffect(() => {
    if (
      !REALTIME_ENABLED ||
      typeof window === "undefined" ||
      typeof EventSource === "undefined"
    ) {
      return;
    }

    let es: EventSource | null = null;
    let open = false;
    let lastSignalAt: number | null = null;
    let lastSub: PingSub | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const refresh = () => {
      const { connected: live } = evaluateStream({
        open,
        lastSignalAt,
        lastSub,
        now: Date.now(),
      });
      setConnected(live);
    };

    const signal = () => {
      lastSignalAt = Date.now();
    };

    const connect = () => {
      if (disposed) return;
      open = false;
      lastSignalAt = null;
      lastSub = null;
      const source = new EventSource("/api/realtime");
      es = source;
      source.addEventListener("open", () => {
        open = true;
        signal();
        refresh();
        // Tabte hændelser mens forbindelsen var nede: tjek timeren nu.
        onPushRef.current();
      });
      source.addEventListener("ping", (event) => {
        const ping = parsePing((event as MessageEvent<string>).data);
        if (!ping) return;
        signal();
        lastSub = ping.sub;
        refresh();
      });
      source.addEventListener("timer", () => {
        signal();
        onPushRef.current();
      });
      source.addEventListener("data", (event) => {
        signal();
        let payload: unknown;
        try {
          payload = JSON.parse((event as MessageEvent<string>).data);
        } catch {
          return;
        }
        const msg = parseDataChangeMessage(payload);
        if (msg) onDataRef.current?.(msg);
      });
      source.onerror = () => {
        // EventSource auto-reconnects on transient errors; polling covers the
        // gap. We just reflect that SSE isn't currently live.
        open = false;
        setConnected(false);
      };
    };

    connect();

    const watchdog = setInterval(() => {
      const { reconnect } = evaluateStream({
        open,
        lastSignalAt,
        lastSub,
        now: Date.now(),
      });
      refresh();
      if (reconnect && es && !reconnectTimer) {
        // Åben men tavs: EventSource opdager ikke en død strøm selv.
        es.close();
        open = false;
        setConnected(false);
        // Jitter, så alle faner ikke rammer serveren samtidig efter et deploy
        reconnectTimer = setTimeout(
          () => {
            reconnectTimer = undefined;
            connect();
          },
          1_000 + Math.random() * 4_000,
        );
      }
    }, WATCHDOG_TICK_MS);

    return () => {
      disposed = true;
      clearInterval(watchdog);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setConnected(false);
      es?.close();
    };
  }, []);

  return { connected };
}
