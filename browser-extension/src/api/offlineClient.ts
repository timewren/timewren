import { ApiError } from "../lib/api-error";
import { useOfflineStore } from "../stores/offlineStore";
import { apiClient } from "./client";

async function getSelectedOrgId(): Promise<string | null> {
  const result = await chrome.storage.local.get(["selectedOrgId"]);
  return typeof result.selectedOrgId === "string" ? result.selectedOrgId : null;
}

/** Snapshot the org selected at queue time so replay targets the right tenant. */
async function withQueuedOrg(
  entry: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const orgId = await getSelectedOrgId();
  return orgId ? { ...entry, organizationId: orgId } : entry;
}

/**
 * Wrapper around apiClient that queues actions when offline
 */
export const offlineClient = {
  /**
   * Create a time entry - queues if offline
   */
  createTimeEntry: async (entry: {
    projectId?: string;
    clientId?: string;
    hours: number;
    description: string;
    date: string;
    startTime?: string;
    endTime?: string;
    source?: "auto_track" | "api";
    prepaidPackageId?: string | null;
  }) => {
    const { isOnline, addToQueue } = useOfflineStore.getState();

    // Idempotency key generated BEFORE the first attempt, so a queued retry of
    // a request that actually committed (response lost) reuses the SAME key
    // and the server dedupes instead of inserting a duplicate entry.
    const keyedEntry = { ...entry, clientEntryId: crypto.randomUUID() };

    if (!isOnline) {
      const payload = await withQueuedOrg(keyedEntry);
      addToQueue({
        type: "createTimeEntry",
        payload,
      });
      return { id: `offline-${Date.now()}`, queued: true };
    }

    try {
      return await apiClient.createTimeEntry(keyedEntry);
    } catch (error) {
      // If network error, queue for later
      if (isNetworkError(error)) {
        useOfflineStore.getState().setOnline(false);
        const payload = await withQueuedOrg(keyedEntry);
        addToQueue({
          type: "createTimeEntry",
          payload,
        });
        return { id: `offline-${Date.now()}`, queued: true };
      }
      throw error;
    }
  },

  /**
   * Update timer state - queues if offline
   */
  updateTimerState: async (state: Record<string, unknown>) => {
    const { isOnline, addToQueue } = useOfflineStore.getState();

    if (!isOnline) {
      addToQueue({
        type: "updateTimerState",
        payload: state,
      });
      return { queued: true };
    }

    try {
      return await apiClient.updateTimerState(state);
    } catch (error) {
      if (isNetworkError(error)) {
        useOfflineStore.getState().setOnline(false);
        addToQueue({
          type: "updateTimerState",
          payload: state,
        });
        return { queued: true };
      }
      throw error;
    }
  },
};

function isNetworkError(error: unknown): boolean {
  if (error instanceof ApiError && error.kind === "network") return true;
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("network") ||
      msg.includes("failed to fetch") ||
      msg.includes("net::err")
    );
  }
  return false;
}
