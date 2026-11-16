import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PomodoroPhase = "work" | "shortBreak" | "longBreak";

interface PomodoroSettings {
  workDuration: number; // in minutes
  shortBreakDuration: number; // in minutes
  longBreakDuration: number; // in minutes
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartWork: boolean;
  soundEnabled: boolean;
}

interface PomodoroState {
  // Mode
  isEnabled: boolean;
  isActive: boolean; // Is pomodoro timer currently running

  // Current session
  phase: PomodoroPhase;
  timeRemaining: number; // in seconds
  sessionsCompleted: number;

  // Settings
  settings: PomodoroSettings;

  // Stats for current day
  todayWorkSessions: number;
  todayTotalWorkMinutes: number;

  // Actions
  toggleEnabled: () => void;
  startPomodoro: () => void;
  pausePomodoro: () => void;
  resumePomodoro: () => void;
  skipPhase: () => void;
  resetPomodoro: () => void;
  tick: () => { phaseComplete: boolean; newPhase: PomodoroPhase | null };
  updateSettings: (settings: Partial<PomodoroSettings>) => void;
  recordWorkSession: (minutes: number) => void;
}

const DEFAULT_SETTINGS: PomodoroSettings = {
  workDuration: 25,
  shortBreakDuration: 5,
  longBreakDuration: 15,
  sessionsBeforeLongBreak: 4,
  autoStartBreaks: false,
  autoStartWork: false,
  soundEnabled: true,
};

function getNextPhase(
  currentPhase: PomodoroPhase,
  sessionsCompleted: number,
  sessionsBeforeLongBreak: number,
): PomodoroPhase {
  if (currentPhase === "work") {
    // After work, check if we should take a long break
    if ((sessionsCompleted + 1) % sessionsBeforeLongBreak === 0) {
      return "longBreak";
    }
    return "shortBreak";
  }
  // After any break, go back to work
  return "work";
}

function getPhaseDuration(
  phase: PomodoroPhase,
  settings: PomodoroSettings,
): number {
  switch (phase) {
    case "work":
      return settings.workDuration * 60;
    case "shortBreak":
      return settings.shortBreakDuration * 60;
    case "longBreak":
      return settings.longBreakDuration * 60;
  }
}

export const usePomodoroStore = create<PomodoroState>()(
  persist(
    (set, get) => ({
      isEnabled: false,
      isActive: false,
      phase: "work",
      timeRemaining: DEFAULT_SETTINGS.workDuration * 60,
      sessionsCompleted: 0,
      settings: DEFAULT_SETTINGS,
      todayWorkSessions: 0,
      todayTotalWorkMinutes: 0,

      toggleEnabled: () => {
        const state = get();
        if (state.isEnabled) {
          // Turning off - reset state
          set({
            isEnabled: false,
            isActive: false,
            phase: "work",
            timeRemaining: state.settings.workDuration * 60,
          });
        } else {
          // Turning on - initialize
          set({
            isEnabled: true,
            isActive: false,
            phase: "work",
            timeRemaining: state.settings.workDuration * 60,
          });
        }
      },

      startPomodoro: () => {
        const state = get();
        set({
          isActive: true,
          // If starting fresh, reset time remaining
          timeRemaining:
            state.timeRemaining > 0
              ? state.timeRemaining
              : getPhaseDuration(state.phase, state.settings),
        });
      },

      pausePomodoro: () => {
        set({ isActive: false });
      },

      resumePomodoro: () => {
        set({ isActive: true });
      },

      skipPhase: () => {
        const state = get();
        const wasWork = state.phase === "work";
        const newSessionsCompleted = wasWork
          ? state.sessionsCompleted + 1
          : state.sessionsCompleted;
        const nextPhase = getNextPhase(
          state.phase,
          state.sessionsCompleted,
          state.settings.sessionsBeforeLongBreak,
        );

        set({
          phase: nextPhase,
          timeRemaining: getPhaseDuration(nextPhase, state.settings),
          sessionsCompleted: newSessionsCompleted,
          isActive: false,
        });
      },

      resetPomodoro: () => {
        const state = get();
        set({
          isActive: false,
          phase: "work",
          timeRemaining: state.settings.workDuration * 60,
          sessionsCompleted: 0,
        });
      },

      tick: () => {
        const state = get();
        if (!state.isActive || state.timeRemaining <= 0) {
          return { phaseComplete: false, newPhase: null };
        }

        const newTimeRemaining = state.timeRemaining - 1;

        if (newTimeRemaining <= 0) {
          // Phase complete
          const wasWork = state.phase === "work";
          const newSessionsCompleted = wasWork
            ? state.sessionsCompleted + 1
            : state.sessionsCompleted;
          const nextPhase = getNextPhase(
            state.phase,
            state.sessionsCompleted,
            state.settings.sessionsBeforeLongBreak,
          );

          // Update stats if work session completed
          if (wasWork) {
            set((s) => ({
              todayWorkSessions: s.todayWorkSessions + 1,
              todayTotalWorkMinutes:
                s.todayTotalWorkMinutes + s.settings.workDuration,
            }));
          }

          // Determine if we should auto-start next phase
          const shouldAutoStart =
            (nextPhase === "work" && state.settings.autoStartWork) ||
            (nextPhase !== "work" && state.settings.autoStartBreaks);

          set({
            phase: nextPhase,
            timeRemaining: getPhaseDuration(nextPhase, state.settings),
            sessionsCompleted: newSessionsCompleted,
            isActive: shouldAutoStart,
          });

          return { phaseComplete: true, newPhase: nextPhase };
        }

        set({ timeRemaining: newTimeRemaining });
        return { phaseComplete: false, newPhase: null };
      },

      updateSettings: (newSettings) => {
        const state = get();
        const updatedSettings = { ...state.settings, ...newSettings };
        set({ settings: updatedSettings });

        // If not active, also update time remaining to reflect new duration
        if (!state.isActive) {
          set({
            timeRemaining: getPhaseDuration(state.phase, updatedSettings),
          });
        }
      },

      recordWorkSession: (minutes) => {
        set((state) => ({
          todayWorkSessions: state.todayWorkSessions + 1,
          todayTotalWorkMinutes: state.todayTotalWorkMinutes + minutes,
        }));
      },
    }),
    {
      name: "pomodoro-storage",
      partialize: (state) => ({
        isEnabled: state.isEnabled,
        settings: state.settings,
        // Don't persist active state or time remaining
      }),
    },
  ),
);
