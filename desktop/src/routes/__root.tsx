import { createRootRoute } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { IdleReturnPrompt } from "@/components/tracker/IdleReturnPrompt";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { DatabaseRecoveryBanner } from "@/components/ui/DatabaseRecoveryBanner";
import { ErrorBoundary } from "@/components/ui/ErrorFallback";
import { LicenseGate } from "@/components/ui/LicenseGate";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { TrialBanner } from "@/components/ui/TrialBanner";
import { UpdateBanner } from "@/components/ui/UpdateBanner";
import { tauriInvoke } from "@/lib/tauri";

function RootComponent() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);

  useEffect(() => {
    tauriInvoke<string | null>("get_setting", { key: "onboarding_completed" })
      .then((value) => {
        if (value !== "true") {
          setShowOnboarding(true);
        }
        setCheckingOnboarding(false);
      })
      .catch(() => {
        // If setting fetch fails, skip onboarding
        setCheckingOnboarding(false);
      });
  }, []);

  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
  }, []);

  return (
    <ErrorBoundary>
      <SplashScreen>
        <AnimatePresence mode="wait">
          {showOnboarding && !checkingOnboarding ? (
            <OnboardingWizard
              key="onboarding"
              onComplete={handleOnboardingComplete}
            />
          ) : null}
        </AnimatePresence>
        {!showOnboarding && !checkingOnboarding && (
          <LicenseGate>
            <UpdateBanner />
            <DatabaseRecoveryBanner />
            <AppShell />
            <TrialBanner />
          </LicenseGate>
        )}
        <CommandPalette />
        <IdleReturnPrompt />
        <ToastContainer />
      </SplashScreen>
    </ErrorBoundary>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
