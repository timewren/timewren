import { Clock, Cloud, ExternalLink, Key, Link2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { tauriInvoke } from "@/lib/tauri";
import { useSyncStore } from "@/stores/syncStore";

interface LicenseProof {
  license_key: string;
  tier: string;
  valid_until: string | null;
  devices_allowed: number;
  issued_at: string;
  verified_at: string;
}

interface LicenseStatus {
  is_valid: boolean;
  tier: string | null;
  days_until_expiry: number | null;
  offline_days: number;
  needs_verification: boolean;
}

interface TrialStatus {
  is_active: boolean;
  days_remaining: number;
  started_at: string | null;
}

type GateState =
  | "loading"
  | "valid" // license or trial is active
  | "onboarding" // onboarding not complete — don't block
  | "blocked"; // no license and no/expired trial

interface LicenseGateProps {
  children: React.ReactNode;
}

export function LicenseGate({ children }: LicenseGateProps) {
  const [gateState, setGateState] = useState<GateState>("loading");
  const [hadTrial, setHadTrial] = useState(false);

  const checkLicense = useCallback(async () => {
    try {
      // Check if onboarding is complete — don't block during onboarding
      const onboardingCompleted = await tauriInvoke<string | null>(
        "get_setting",
        { key: "onboarding_completed" },
      );
      if (onboardingCompleted !== "true") {
        setGateState("onboarding");
        return;
      }

      // Check license
      const [proof, licenseStatus, trialStatus] = await Promise.all([
        tauriInvoke<LicenseProof | null>("get_license_info"),
        tauriInvoke<LicenseStatus>("verify_license"),
        tauriInvoke<TrialStatus>("check_trial_status"),
      ]);

      // Has valid license
      if (proof && licenseStatus.is_valid) {
        setGateState("valid");
        return;
      }

      // Connected to TimeTrack Cloud (subscription = license)
      const syncToken = await tauriInvoke<string | null>("get_setting", {
        key: "sync_token",
      });
      if (syncToken) {
        setGateState("valid");
        return;
      }

      // Has active trial
      if (trialStatus.is_active) {
        setGateState("valid");
        return;
      }

      // Had a trial that expired
      if (trialStatus.started_at && !trialStatus.is_active) {
        setHadTrial(true);
      }

      setGateState("blocked");
    } catch {
      // If we can't check, don't block the user
      setGateState("valid");
    }
  }, []);

  useEffect(() => {
    checkLicense();

    // Re-check every 24 hours
    const interval = setInterval(
      () => {
        checkLicense();
      },
      24 * 60 * 60 * 1000,
    );

    return () => clearInterval(interval);
  }, [checkLicense]);

  if (gateState === "loading") {
    return null; // SplashScreen handles this
  }

  if (gateState === "onboarding" || gateState === "valid") {
    return <>{children}</>;
  }

  // Blocked state — show children dimmed + block screen overlay
  return (
    <>
      <div className="pointer-events-none select-none blur-sm brightness-50">
        {children}
      </div>
      <LicenseBlockScreen hadTrial={hadTrial} onActivated={checkLicense} />
    </>
  );
}

function LicenseBlockScreen({
  hadTrial,
  onActivated,
}: {
  hadTrial: boolean;
  onActivated: () => void;
}) {
  const { t } = useTranslation();
  const syncStore = useSyncStore();
  const [licenseKey, setLicenseKey] = useState("");
  const [activating, setActivating] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stop tracking when blocked
  useEffect(() => {
    tauriInvoke("stop_tracking").catch(() => {});
  }, []);

  // If sync connects successfully, re-check license
  useEffect(() => {
    if (syncStore.isLoggedIn) {
      onActivated();
    }
  }, [syncStore.isLoggedIn, onActivated]);

  const handleActivate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const key = licenseKey.trim();
      if (!key) return;

      setActivating(true);
      setError(null);

      try {
        await tauriInvoke<LicenseProof>("activate_license", {
          licenseKey: key,
        });
        onActivated();
      } catch (err) {
        setError(
          typeof err === "string" ? err : t("licenseGate.activationFailed"),
        );
      } finally {
        setActivating(false);
      }
    },
    [licenseKey, onActivated, t],
  );

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-(--color-border) bg-(--color-bg) p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          {/* Logo */}
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-(--color-accent)">
            <Clock size={32} className="text-white" />
          </div>

          {/* Title */}
          <h2 className="text-xl font-bold text-(--color-text)">
            {hadTrial
              ? t("licenseGate.trialExpired")
              : t("licenseGate.noLicense")}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-(--color-text-muted)">
            {hadTrial
              ? t("licenseGate.trialExpiredDesc")
              : t("licenseGate.noLicenseDesc")}
          </p>

          {/* Option 1: Connect to TimeTrack Cloud */}
          <div className="mt-6 w-full space-y-3">
            <Button
              size="lg"
              className="w-full"
              onClick={() => syncStore.connect()}
              disabled={syncStore.isConnecting}
            >
              {syncStore.isConnecting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t("licenseGate.cloudWaiting")}
                </>
              ) : (
                <>
                  <Cloud size={16} />
                  <Link2 size={16} />
                  {t("licenseGate.cloudConnect")}
                </>
              )}
            </Button>
            <p className="text-xs text-(--color-text-muted)">
              {t("licenseGate.cloudConnectDesc")}
            </p>

            {syncStore.error && (
              <p className="text-xs text-red-400">{syncStore.error}</p>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 flex w-full items-center gap-3">
            <div className="h-px flex-1 bg-(--color-border)" />
            <span className="text-xs text-(--color-text-muted)">
              {t("common.or")}
            </span>
            <div className="h-px flex-1 bg-(--color-border)" />
          </div>

          {/* Option 2: License key */}
          {showKeyInput ? (
            <form
              onSubmit={handleActivate}
              className="flex w-full items-center gap-2"
            >
              <Input
                value={licenseKey}
                onChange={(e) => {
                  setLicenseKey(e.target.value);
                  setError(null);
                }}
                placeholder="TT-XXXX-XXXX-XXXX-XXXX"
                aria-label={t("license.enterKey")}
                className="flex-1 font-mono text-sm"
              />
              <Button
                type="submit"
                size="md"
                disabled={activating || !licenseKey.trim()}
              >
                {activating ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <>
                    <Key size={14} />
                    {t("licenseGate.activate")}
                  </>
                )}
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowKeyInput(true)}
              className="flex items-center gap-2 text-sm text-(--color-text-muted) transition-colors hover:text-(--color-text)"
            >
              <Key size={14} />
              {t("licenseGate.haveKey")}
            </button>
          )}

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

          {/* Buy lifetime license */}
          <div className="mt-5 w-full rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
            <p className="text-sm font-medium text-(--color-text)">
              {t("licenseGate.buyLifetimeTitle")}
            </p>
            <p className="mt-1 text-xs text-(--color-text-muted)">
              {t("licenseGate.buyLifetimeDesc")}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() =>
                window.open("https://timetrack.dk/desktop", "_blank")
              }
            >
              <ExternalLink size={14} />
              {t("licenseGate.buy")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
