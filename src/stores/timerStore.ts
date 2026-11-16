import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TimerState {
  isRunning: boolean;
  startTime: number | null; // Current session start (resets on pause/resume)
  sessionStartTime: number | null; // Original session start (when work actually began)
  elapsedTime: number; // in seconds - total displayed time
  baseTime: number; // in seconds - accumulated time before current session (pause + bonus)
  projectId: string | null;
  clientId: string | null;
  taskId: string | null; // Link to task for time blocking feature
  description: string;
  continuingEntryId: string | null; // ID of existing entry being continued
  // Timer der allerede står på den fortsatte postering. Bæres SEPARAT fra
  // sessionens elapsed/base: sessionen starter på 0 og synkes uden base, så
  // andre klienter ikke ser et tidsspring og ikke kan gemme gammel+ny tid som
  // en ny post. Ved gem: postens timer = continuingEntryHours + sessionen.
  continuingEntryHours: number;
  resumeEntryId: string | null; // ID of existing entry to add a new segment to
  // Server-udstedt session (docs/architecture/timer-sessions.md). Sat ud fra
  // serverens svar; null for en start serveren endnu ikke har bekræftet.
  // Sendes med på alle skrivninger, så en forældet kopi aldrig kan ramme en
  // anden session (eller genoplive en afsluttet).
  sessionId: string | null;
  // Idempotensnøglen på en NY start, indtil serveren har svaret på den. Går
  // svaret tabt, er det den eneste identitet sessionen har: genforsøget og
  // alle skrivninger til sessionen bærer den, indtil id'et kendes (#786).
  // Persisteret, så en genindlæsning ikke glemmer den.
  startOpId: string | null;

  startTimer: (opts?: {
    clientId?: string | null;
    projectId?: string | null;
    description?: string;
    taskId?: string | null;
  }) => void;
  stopTimer: () => {
    duration: number;
    startTime: number; // Original session start (ISO timestamp)
    endTime: number; // When timer was stopped (ISO timestamp)
    taskId: string | null; // Task that was being tracked
    description: string; // Description at time of stop
    resumeEntryId: string | null; // Entry to append a new segment to (if any)
  } | null;
  pauseTimer: () => void;
  resumeTimer: () => void;
  resetTimer: () => void;
  setSessionId: (sessionId: string | null) => void;
  setStartOpId: (startOpId: string | null) => void;
  updateDescription: (description: string) => void;
  updateProject: (projectId: string, clientId: string) => void;
  updateTask: (taskId: string | null) => void;
  addMinutes: (minutes: number) => void;
  tick: () => void;
  resumeFromEntry: (entry: {
    projectId?: string;
    clientId?: string;
    description: string;
    taskId?: string;
  }) => void;
  startTimerFromTask: (task: {
    id: string;
    title: string;
    projectId?: string | null;
    clientId?: string | null;
  }) => void;
  continueEntry: (entry: {
    entryId: string;
    projectId?: string;
    clientId?: string;
    description: string;
    hours: number;
  }) => void;
  resumeAsSegment: (entry: {
    entryId: string;
    projectId?: string;
    clientId?: string;
    description: string;
    taskId?: string;
  }) => void;
}

/**
 * Ægte pause = brugeren har selv sat timeren på pause og har uafsluttet tid
 * på den kunde timeren står på. En pauset tid må aldrig følge med over på
 * en anden kunde (kunde A 7/9: "1 time på intern tid blev lagt oven på
 * næste registrering"). Parkerede rester uden sessionStartTime er IKKE en
 * pause — de er allerede gemt på en anden enhed.
 */
export function isGenuinePause(state: {
  isRunning: boolean;
  elapsedTime: number;
  baseTime: number;
  sessionStartTime: number | null;
}): boolean {
  return (
    !state.isRunning &&
    (state.elapsedTime > 0 || state.baseTime > 0) &&
    state.sessionStartTime !== null
  );
}

export const useTimerStore = create<TimerState>()(
  persist(
    (set, get) => ({
      isRunning: false,
      startTime: null,
      sessionStartTime: null, // Tracks when work session originally began
      elapsedTime: 0,
      baseTime: 0, // accumulated time from pauses and added minutes
      projectId: null,
      clientId: null,
      taskId: null, // Link to task for time blocking feature
      description: "",
      continuingEntryId: null,
      continuingEntryHours: 0,
      resumeEntryId: null,
      sessionId: null,
      startOpId: null,

      startTimer: (opts = {}) => {
        if (get().isRunning) return;
        const {
          clientId = null,
          projectId = null,
          description = "",
          taskId = null,
        } = opts;
        const now = Date.now();
        set({
          isRunning: true,
          startTime: now,
          sessionStartTime: now, // Record original start time
          elapsedTime: 0,
          baseTime: 0,
          projectId: projectId || null,
          clientId: clientId || null,
          taskId: taskId || null,
          description,
          continuingEntryId: null,
          continuingEntryHours: 0,
          resumeEntryId: null,
          sessionId: null,
          startOpId: null,
        });
      },

      stopTimer: () => {
        const state = get();
        if (!state.sessionStartTime) return null;

        const duration = state.elapsedTime; // in seconds
        const startTime = state.sessionStartTime; // Original session start
        const endTime = Date.now(); // When timer was stopped
        const taskId = state.taskId;
        const description = state.description; // Capture before clearing
        const resumeEntryId = state.resumeEntryId; // Capture before clearing

        set({
          isRunning: false,
          startTime: null,
          sessionStartTime: null,
          elapsedTime: 0,
          baseTime: 0,
          projectId: null,
          clientId: null,
          taskId: null,
          description: "",
          continuingEntryId: null,
          continuingEntryHours: 0,
          resumeEntryId: null,
          sessionId: null,
          startOpId: null,
        });

        return {
          duration,
          startTime,
          endTime,
          taskId,
          description,
          resumeEntryId,
        };
      },

      pauseTimer: () => {
        const state = get();
        // Save current elapsed time as base time for when we resume
        // Keep sessionStartTime to preserve original start
        set({
          isRunning: false,
          baseTime: state.elapsedTime,
        });
      },

      resumeTimer: () => {
        const state = get();
        // Only genuine paused sessions may resume: a state with elapsed time
        // but NO sessionStartTime is a parked copy of a stop that completed
        // (and was saved) on another client — resuming it would ride the old
        // time into the next entry. Guarded here so every call site (and any
        // future one) inherits the rule.
        if (!state.sessionStartTime) return;
        if (state.elapsedTime > 0 || state.baseTime > 0) {
          // Start a new timing session, keeping baseTime
          // Keep sessionStartTime (don't reset on resume)
          set({
            isRunning: true,
            startTime: Date.now(),
          });
        }
      },

      resetTimer: () => {
        set({
          isRunning: false,
          startTime: null,
          sessionStartTime: null,
          elapsedTime: 0,
          baseTime: 0,
          projectId: null,
          clientId: null,
          taskId: null,
          description: "",
          continuingEntryId: null,
          continuingEntryHours: 0,
          resumeEntryId: null,
          sessionId: null,
          startOpId: null,
        });
      },

      setSessionId: (sessionId) => {
        set({ sessionId });
      },

      setStartOpId: (startOpId) => {
        set({ startOpId });
      },

      updateDescription: (description) => {
        set({ description });
      },

      updateProject: (projectId, clientId) => {
        set((state) => {
          const nextClientId = clientId || null;
          const clientChanged = nextClientId !== (state.clientId || null);
          // Skifter kunden midt i en fortsat postering (eller et segment),
          // hører den løbende tid ikke længere til den oprindelige postering.
          // Uden dette blev postering A opdateret med kunde B's data ved stop
          // — kunde A's registrerede tid blev altså byttet ud (kunde A 28/8).
          return clientChanged
            ? {
                projectId,
                clientId,
                continuingEntryId: null,
                continuingEntryHours: 0,
                resumeEntryId: null,
              }
            : { projectId, clientId };
        });
      },

      updateTask: (taskId) => {
        set({ taskId });
      },

      addMinutes: (minutes) => {
        set((state) => ({
          // Add to baseTime so it persists through ticks
          baseTime: state.baseTime + minutes * 60,
          elapsedTime: state.elapsedTime + minutes * 60,
        }));
      },

      tick: () => {
        const state = get();
        if (state.isRunning && state.startTime) {
          // Elapsed = base time + time since current session started
          const currentSessionTime = Math.floor(
            (Date.now() - state.startTime) / 1000,
          );
          // Safety: cap at 24 hours (86400 seconds) per session
          // If startTime is corrupted/very old, this prevents huge values
          const safeSessionTime = Math.min(currentSessionTime, 86400);
          const newElapsed = state.baseTime + safeSessionTime;
          // Cap total at 999 hours
          set({ elapsedTime: Math.min(newElapsed, 3596400) });
        }
      },

      resumeFromEntry: (entry) => {
        if (get().isRunning) return;
        const now = Date.now();
        set({
          isRunning: true,
          startTime: now,
          sessionStartTime: now, // Record original start time for new session
          elapsedTime: 0,
          baseTime: 0,
          projectId: entry.projectId || null,
          clientId: entry.clientId || null,
          taskId: entry.taskId || null,
          description: entry.description,
          continuingEntryId: null,
          continuingEntryHours: 0,
          resumeEntryId: null,
          sessionId: null,
          startOpId: null,
        });
      },

      startTimerFromTask: (task) => {
        if (get().isRunning) return;
        const now = Date.now();
        set({
          isRunning: true,
          startTime: now,
          sessionStartTime: now,
          elapsedTime: 0,
          baseTime: 0,
          projectId: task.projectId || null,
          clientId: task.clientId || null,
          taskId: task.id,
          description: task.title, // Use task title as description
          continuingEntryId: null,
          continuingEntryHours: 0,
          resumeEntryId: null,
          sessionId: null,
          startOpId: null,
        });
      },

      continueEntry: (entry) => {
        if (get().isRunning) return;
        const now = Date.now();
        // Den nye session starter på 0. Postens eksisterende timer lægges
        // først til ved gem — postens starttid og dato røres ikke (kunde A:
        // "Fortsæt" flyttede starttiden, så den ikke passede med ankomst).
        set({
          isRunning: true,
          startTime: now,
          sessionStartTime: now,
          elapsedTime: 0,
          baseTime: 0,
          projectId: entry.projectId || null,
          clientId: entry.clientId || null,
          taskId: null,
          description: entry.description,
          continuingEntryId: entry.entryId,
          continuingEntryHours: Number.isFinite(entry.hours)
            ? Math.max(0, entry.hours)
            : 0,
          resumeEntryId: null,
          sessionId: null,
          startOpId: null,
        });
      },

      resumeAsSegment: (entry) => {
        if (get().isRunning) return;
        const now = Date.now();
        set({
          isRunning: true,
          startTime: now,
          sessionStartTime: now,
          elapsedTime: 0,
          baseTime: 0,
          projectId: entry.projectId || null,
          clientId: entry.clientId || null,
          taskId: entry.taskId || null,
          description: entry.description,
          resumeEntryId: entry.entryId,
          continuingEntryId: null,
          continuingEntryHours: 0,
          sessionId: null,
          startOpId: null,
        });
      },
    }),
    {
      name: "timer-storage",
    },
  ),
);
