import { create } from "zustand";
import { tauriInvoke } from "@/lib/tauri";
import type { TimeEntry } from "@/lib/types";
import { toast } from "@/stores/toastStore";

interface TimerState {
  isRunning: boolean;
  startTime: string | null;
  projectId: string | null;
  clientId: string | null;
  description: string | null;
  elapsed: number;
  entryId: string | null;
  projectName: string | null;
  clientName: string | null;
  projectColor: string | null;

  start: (
    projectId?: string | null,
    clientId?: string | null,
    description?: string | null,
  ) => Promise<void>;
  stop: () => Promise<void>;
  tick: () => void;
  loadRunning: () => Promise<void>;
}

// Module-level interval ref to avoid serialization issues
let tickInterval: ReturnType<typeof setInterval> | null = null;

function startTicking(tick: () => void) {
  stopTicking();
  tickInterval = setInterval(tick, 1000);
}

function stopTicking() {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function calcElapsedFromStart(startTime: string): number {
  const start = new Date(startTime).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((now - start) / 1000));
}

export const useTimerStore = create<TimerState>()((set, get) => ({
  isRunning: false,
  startTime: null,
  projectId: null,
  clientId: null,
  description: null,
  elapsed: 0,
  entryId: null,
  projectName: null,
  clientName: null,
  projectColor: null,

  start: async (projectId, clientId, description) => {
    try {
      const entry = await tauriInvoke<TimeEntry>("start_timer", {
        projectId: projectId ?? null,
        clientId: clientId ?? null,
        description: description ?? null,
      });

      set({
        isRunning: true,
        startTime: entry.start_time,
        projectId: entry.project_id,
        clientId: entry.client_id,
        description: entry.description,
        elapsed: 0,
        entryId: entry.id,
        projectName: entry.project_name,
        clientName: entry.client_name,
        projectColor: entry.project_color,
      });

      startTicking(get().tick);
    } catch (err) {
      console.error("Failed to start timer:", err);
      toast.error("Kunne ikke starte timer");
    }
  },

  stop: async () => {
    try {
      await tauriInvoke("stop_timer");
      stopTicking();

      set({
        isRunning: false,
        startTime: null,
        projectId: null,
        clientId: null,
        description: null,
        elapsed: 0,
        entryId: null,
        projectName: null,
        clientName: null,
        projectColor: null,
      });
    } catch (err) {
      console.error("Failed to stop timer:", err);
      toast.error("Kunne ikke stoppe timer");
    }
  },

  tick: () => {
    set((state) => ({ elapsed: state.elapsed + 1 }));
  },

  loadRunning: async () => {
    try {
      const entry = await tauriInvoke<TimeEntry | null>("get_running_timer");
      if (entry?.is_running) {
        const elapsed = calcElapsedFromStart(entry.start_time);

        set({
          isRunning: true,
          startTime: entry.start_time,
          projectId: entry.project_id,
          clientId: entry.client_id,
          description: entry.description,
          elapsed,
          entryId: entry.id,
          projectName: entry.project_name,
          clientName: entry.client_name,
          projectColor: entry.project_color,
        });

        startTicking(get().tick);
      }
    } catch (err) {
      console.error("Failed to load running timer:", err);
    }
  },
}));
