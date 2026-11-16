import { create } from "zustand";
import { readStoredQueue, updateStoredQueue } from "../lib/offline-queue";

export interface QueuedAction {
  id: string;
  type: "createTimeEntry" | "updateTimerState" | "confirmStop";
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount: number;
  /** Baggrunden afspiller ikke posten før dette tidspunkt (write-ahead). */
  notBefore?: string | null;
  /** Binder et write-ahead-gem og dets confirmStop sammen (clientEntryId). */
  group?: string | null;
}

interface OfflineState {
  isOnline: boolean;
  queue: QueuedAction[];
  isSyncing: boolean;
  lastSyncError: string | null;

  setOnline: (online: boolean) => void;
  addToQueue: (
    action: Omit<QueuedAction, "id" | "createdAt" | "retryCount">,
  ) => void;
  clearQueue: () => void;
  setSyncing: (syncing: boolean) => void;
  setSyncError: (error: string | null) => void;
  loadQueue: () => Promise<void>;
}

export const useOfflineStore = create<OfflineState>((set) => ({
  isOnline: navigator.onLine,
  queue: [],
  isSyncing: false,
  lastSyncError: null,

  setOnline: (online) => set({ isOnline: online }),

  addToQueue: (action) => {
    const newAction: QueuedAction = {
      ...action,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      retryCount: 0,
    };

    set((state) => ({
      queue: [...state.queue, newAction],
    }));

    // Gem i storage under køens lås (baggrunden kan skrive samtidig)
    void updateStoredQueue<QueuedAction>((queue) => [...queue, newAction])
      .then((queue) => set({ queue }))
      .catch((error) => console.error("Failed to save offline queue:", error));
  },

  clearQueue: () => {
    set({ queue: [] });
    void updateStoredQueue<QueuedAction>(() => []).catch(() => {});
  },

  setSyncing: (syncing) => set({ isSyncing: syncing }),

  setSyncError: (error) => set({ lastSyncError: error }),

  loadQueue: async () => {
    try {
      const result = await chrome.storage.local.get(["offlineQueue"]);
      if (Array.isArray(result.offlineQueue)) {
        set({ queue: result.offlineQueue as QueuedAction[] });
      }
    } catch (error) {
      console.error("Failed to load offline queue:", error);
    }
  },
}));

// Initialize online/offline listeners
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    useOfflineStore.getState().setOnline(true);
  });

  window.addEventListener("offline", () => {
    useOfflineStore.getState().setOnline(false);
  });
}

/**
 * Direkte læs-ændr-skriv på den persistede kø. Bruges af stop-flowet, hvor
 * popup'ens in-memory-kø kan være forældet (baggrunden fjerner afspillede
 * poster), og hvor posterne SKAL ligge i storage før netværkskaldet.
 */
async function writeStoredQueue(
  change: (queue: QueuedAction[]) => QueuedAction[],
): Promise<void> {
  const queue = await updateStoredQueue(change);
  useOfflineStore.setState({ queue });
}

/** Læg poster i køen (i rækkefølge) og returnér deres id'er. */
export async function enqueuePersisted(
  actions: Array<Omit<QueuedAction, "id" | "createdAt" | "retryCount">>,
): Promise<string[]> {
  const now = new Date().toISOString();
  const added: QueuedAction[] = actions.map((a) => ({
    ...a,
    id: crypto.randomUUID(),
    createdAt: now,
    retryCount: 0,
  }));
  await writeStoredQueue((queue) => [...queue, ...added]);
  return added.map((a) => a.id);
}

export async function removePersisted(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await writeStoredQueue((queue) => queue.filter((a) => !ids.includes(a.id)));
}

/** Gør write-ahead-poster klar til afspilning med det samme. */
export async function releasePersisted(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await writeStoredQueue((queue) =>
    queue.map((a) => (ids.includes(a.id) ? { ...a, notBefore: null } : a)),
  );
}

/** Skub write-ahead-fristen (popup'en arbejder stadig på gemmet). */
export async function deferPersisted(ids: string[], ms: number): Promise<void> {
  if (ids.length === 0) return;
  const notBefore = new Date(Date.now() + ms).toISOString();
  await writeStoredQueue((queue) =>
    queue.map((a) => (ids.includes(a.id) ? { ...a, notBefore } : a)),
  );
}

/** Versioner, som vores kø har en ventende confirmStop for (eget stop). */
export async function pendingStopVersions(): Promise<number[]> {
  try {
    const queue = await readStoredQueue<QueuedAction>();
    return queue
      .filter((a) => a.type === "confirmStop")
      .map((a) => Number(a.payload.version))
      .filter((v) => Number.isFinite(v));
  } catch {
    return [];
  }
}
