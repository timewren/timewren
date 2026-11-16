import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TourState {
  hasCompletedTour: boolean;
  isActive: boolean;
  currentStep: number;

  startTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  setStep: (step: number) => void;
  skipTour: () => void;
  completeTour: () => void;
  resetTour: () => void;
}

export const useTourStore = create<TourState>()(
  persist(
    (set) => ({
      hasCompletedTour: false,
      isActive: false,
      currentStep: 0,

      startTour: () => set({ isActive: true, currentStep: 0 }),

      nextStep: () => set((state) => ({ currentStep: state.currentStep + 1 })),

      prevStep: () =>
        set((state) => ({
          currentStep: Math.max(0, state.currentStep - 1),
        })),

      setStep: (step) => set({ currentStep: step }),

      skipTour: () =>
        set({ isActive: false, currentStep: 0, hasCompletedTour: true }),

      completeTour: () =>
        set({ isActive: false, currentStep: 0, hasCompletedTour: true }),

      resetTour: () =>
        set({ hasCompletedTour: false, isActive: false, currentStep: 0 }),
    }),
    {
      name: "tour-storage",
      partialize: (state) => ({ hasCompletedTour: state.hasCompletedTour }),
    },
  ),
);
