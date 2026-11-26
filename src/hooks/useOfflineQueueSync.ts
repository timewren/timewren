"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { toIntlLocale } from "@/i18n/format-locale";
import { sharedT } from "@/i18n/shared-text";
import { currentSyncLocale } from "@/i18n/sync-text";
import { useSession } from "@/lib/auth-client";
import { toLocalDateStr } from "@/lib/format";
import {
  type CreateEntryInput,
  clipEntry,
  nextWakeupAt,
  OFFLINE_QUEUE_DRAINED_EVENT,
  pendingCount,
  type QueueItem,
} from "@/lib/offline/queue";
import {
  type DrainEvent,
  drainQueue,
  type ReplayApi,
} from "@/lib/offline/replay";
import { broadcastDataChange } from "@/lib/query/cross-tab";
import {
  invalidateDomains,
  TIME_ENTRY_DOMAINS,
} from "@/lib/query/invalidate-domains";
import { trpc } from "@/providers/trpc-provider";
import { newOpId, useOfflineQueueStore } from "@/stores/offlineQueueStore";
import { useTimerStore } from "@/stores/timerStore";

const MAX_WAKEUP_MS = 2 * 60_000;
const LOCK_NAME = "timetrack-offline-queue";

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(toIntlLocale(currentSyncLocale()), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Konflikt på en køet start: en anden enhed startede en timer imens. Den
 * kørende timer på serveren vinder (én timer pr. bruger). Kører vores
 * offline-session stadig lokalt, gemmes den som tidspost klippet til det
 * øjeblik, den anden timer startede — så tiden hverken tabes eller tælles to
 * gange — og den lokale timer nulstilles, så reconcile kan adoptere den anden.
 */
function resolveLocalConflict(event: DrainEvent) {
  if (event.item.kind !== "timer.start") return;
  const sessionStart = event.item.payload.sessionStartTime;
  const local = useTimerStore.getState();
  if (local.sessionStartTime !== sessionStart) {
    // Sessionen blev stoppet offline — stoppet i køen er allerede klippet.
    toast.warning(
      event.droppedStops
        ? sharedT("sharedLabels", "offlineSync.fullOverlap")
        : sharedT("sharedLabels", "offlineSync.partialOverlap"),
      { duration: 12_000 },
    );
    return;
  }

  const end = Math.min(Date.now(), event.otherStart ?? Date.now());
  const full: CreateEntryInput = {
    projectId: local.projectId || undefined,
    clientId: !local.projectId ? local.clientId || undefined : undefined,
    description:
      local.description ||
      sharedT("sharedLabels", "offlineSync.defaultDescription"),
    hours: Math.max(0.01, local.elapsedTime / 3600),
    date: toLocalDateStr(new Date(sessionStart)),
    startTime: new Date(sessionStart).toISOString(),
    endTime: new Date(Date.now()).toISOString(),
    taskId: local.taskId || undefined,
    fromTimer: true,
  };
  const entry = clipEntry(full, sessionStart, end);
  local.resetTimer();
  if (entry) {
    useOfflineQueueStore
      .getState()
      .enqueue({ kind: "time.create", opId: newOpId(), entry });
    toast.warning(
      sharedT("sharedLabels", "offlineSync.clippedSaved", {
        from: clock(sessionStart),
        to: clock(end),
      }),
      { duration: 12_000 },
    );
  } else {
    toast.warning(
      sharedT("sharedLabels", "offlineSync.resetOffline", {
        from: clock(sessionStart),
      }),
      { duration: 12_000 },
    );
  }
}

function reportEvents(events: DrainEvent[]) {
  for (const event of events) {
    if (event.type === "start_conflict") {
      resolveLocalConflict(event);
    } else if (event.type === "stopped_elsewhere") {
      toast.info(sharedT("sharedLabels", "offlineSync.stoppedElsewhere"), {
        duration: 10_000,
      });
    } else {
      toast.error(
        sharedT("sharedLabels", "offlineSync.syncFailed", {
          error:
            event.item.lastError ?? sharedT("sharedLabels", "unknownError"),
        }),
        { duration: 12_000 },
      );
    }
  }
}

/**
 * Dræner offline-køen ved online-overgang, ved mount, når noget nyt lægges i
 * køen og når et element i backoff bliver klar. Monteres én gang i dashboard-
 * skallen. Faner deler køen via localStorage, så dræningen tages under en Web
 * Lock — kun én fane afspiller ad gangen (idempotensnøglerne dækker resten).
 */
export function useOfflineQueueSync() {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const items = useOfflineQueueStore((s) => s.items);
  const isOnline = useOfflineQueueStore((s) => s.isOnline);
  const pending = pendingCount(items);
  const drainingRef = useRef(false);

  const userId = session?.user?.id;
  useEffect(() => {
    if (userId) useOfflineQueueStore.getState().adoptOwner(userId);
  }, [userId]);

  // Den aktive org stemples på nye køelementer (se offlineQueueStore).
  const activeOrgId = (
    session?.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;
  useEffect(() => {
    if (userId) {
      useOfflineQueueStore.getState().setCurrentOrg(activeOrgId ?? null);
    }
  }, [userId, activeOrgId]);

  // Ét API pr. element: kaldene bærer elementets org, så en post lagt i køen
  // i org A gemmes i org A, selv om brugeren har skiftet til org B imens.
  const buildApi = (orgId: string | null | undefined): ReplayApi => {
    const opts = orgId ? { context: { orgId } } : undefined;
    return {
      syncStart: (p) =>
        utils.client.timerSync.sync.mutate(
          {
            isRunning: true,
            startTime: p.startTime,
            sessionStartTime: p.sessionStartTime,
            elapsedSeconds: p.elapsedSeconds,
            baseSeconds: p.baseSeconds,
            projectId: p.projectId,
            clientId: p.clientId,
            taskId: p.taskId,
            description: p.description,
            source: "web",
            isFreshStart: true,
            isAdoption: false,
            clientOpId: p.clientOpId,
          },
          opts,
        ) as ReturnType<ReplayApi["syncStart"]>,
      getTimerState: () =>
        utils.client.timerSync.getStateWithVersion.query(undefined, opts),
      claimForStop: (expectedVersion, sessionId) =>
        utils.client.timerSync.claimForStop.mutate(
          { expectedVersion, source: "web", sessionId },
          opts,
        ),
      confirmStop: (version, sessionId) =>
        utils.client.timerSync.confirmStop.mutate(
          { version, source: "web", sessionId },
          opts,
        ),
      createEntry: (entry) => utils.client.time.create.mutate(entry, opts),
    };
  };
  const api = useRef<((item: QueueItem) => ReplayApi) | null>(null);
  api.current = (item) => buildApi(item.orgId);

  const drain = useCallback(async () => {
    const store = useOfflineQueueStore.getState();
    if (drainingRef.current || !store.isOnline) return;
    if (!userId || store.ownerUserId !== userId) return;
    drainingRef.current = true;

    const run = async () => {
      // En anden fane kan have ændret køen — læs den friske kopi først.
      await useOfflineQueueStore.persist.rehydrate();
      const s = useOfflineQueueStore.getState();
      if (pendingCount(s.items) === 0 || !api.current) return;
      s.setSyncing(true);
      try {
        const result = await drainQueue(
          {
            getItems: () => useOfflineQueueStore.getState().items,
            setItems: (next) => useOfflineQueueStore.getState().setItems(next),
            setInFlight: (opId) =>
              useOfflineQueueStore.getState().setInFlight(opId),
          },
          api.current,
        );
        for (const sessionStart of result.establishedSessions) {
          useOfflineQueueStore.getState().setEstablishedSession(sessionStart);
        }
        reportEvents(result.events);
        if (result.succeeded > 0 || result.events.length > 0) {
          // Afspilningen går uden om MutationCache (vanilla-klienten), så
          // her invalideres alt en gemt post kan ændre — også i de andre faner.
          const domains = [...TIME_ENTRY_DOMAINS, "timerSync"];
          void invalidateDomains(queryClient, domains);
          broadcastDataChange(domains);
        }
        if (pendingCount(useOfflineQueueStore.getState().items) === 0) {
          useOfflineQueueStore.getState().markSynced();
          window.dispatchEvent(new Event(OFFLINE_QUEUE_DRAINED_EVENT));
        }
      } finally {
        useOfflineQueueStore.getState().setSyncing(false);
      }
    };

    try {
      if (typeof navigator !== "undefined" && navigator.locks?.request) {
        await navigator.locks.request(LOCK_NAME, run);
      } else {
        await run();
      }
    } catch (error) {
      console.error("[Offline-kø] Dræning fejlede:", error);
    } finally {
      drainingRef.current = false;
    }
  }, [userId, queryClient]);

  // Online/offline fra browseren.
  useEffect(() => {
    const update = () => {
      const online = navigator.onLine !== false;
      useOfflineQueueStore.getState().setOnline(online);
      if (online) void drain();
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [drain]);

  // En anden fane lagde noget i køen.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === useOfflineQueueStore.persist.getOptions().name) {
        void useOfflineQueueStore.persist.rehydrate();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Noget nyt i køen mens vi er online → prøv med det samme.
  useEffect(() => {
    if (pending > 0 && isOnline) void drain();
  }, [pending, isOnline, drain]);

  // Et element i backoff skal prøves igen, når ventetiden er gået.
  useEffect(() => {
    if (!isOnline) return;
    const wakeupAt = nextWakeupAt(items, Date.now());
    if (wakeupAt === null) return;
    const delay = Math.min(Math.max(wakeupAt - Date.now(), 0), MAX_WAKEUP_MS);
    const timer = setTimeout(() => void drain(), delay);
    return () => clearTimeout(timer);
  }, [items, isOnline, drain]);

  return { drain };
}
