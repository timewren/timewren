import { ExternalLink, Gift, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toLocalDateStr } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";

interface TrialStatus {
  is_active: boolean;
  days_remaining: number;
  started_at: string | null;
}

interface LicenseProof {
  license_key: string;
  tier: string;
  valid_until: string | null;
  devices_allowed: number;
  issued_at: string;
  verified_at: string;
}

const DISMISS_KEY = "trial_banner_dismissed_at";

/**
 * Non-blocking banner shown during the last 14 days of a trial period.
 * Encourages upgrade to lifetime license. Can be dismissed (re-appears next day).
 */
export function TrialBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [daysLeft, setDaysLeft] = useState(0);

  const checkTrial = useCallback(async () => {
    try {
      // Don't show if user has a license
      const proof = await tauriInvoke<LicenseProof | null>("get_license_info");
      if (proof) return;

      // Don't show if connected to cloud (subscription includes desktop)
      const syncToken = await tauriInvoke<string | null>("get_setting", {
        key: "sync_token",
      });
      if (syncToken) return;

      const trial = await tauriInvoke<TrialStatus>("check_trial_status");
      if (!trial.is_active || trial.days_remaining > 16) return;

      // Check if dismissed today
      const dismissedAt = localStorage.getItem(DISMISS_KEY);
      if (dismissedAt) {
        const today = toLocalDateStr(new Date());
        if (dismissedAt === today) return;
      }

      setDaysLeft(trial.days_remaining);
      setVisible(true);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    checkTrial();
  }, [checkTrial]);

  const handleDismiss = useCallback(() => {
    const today = toLocalDateStr(new Date());
    localStorage.setItem(DISMISS_KEY, today);
    setVisible(false);
  }, []);

  const handleBuy = useCallback(() => {
    window.open("https://timetrack.dk/desktop", "_blank");
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[9990] flex items-center justify-center p-3">
      <div className="flex w-full max-w-2xl items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 shadow-lg backdrop-blur-sm">
        <Gift size={18} className="shrink-0 text-amber-400" />
        <div className="flex-1 text-sm text-(--color-text)">
          <span className="font-medium">
            {t("trialBanner.daysLeft", { days: daysLeft })}
          </span>
          <span className="mx-2 text-(--color-text-muted)">—</span>
          <span className="text-(--color-text-muted)">
            {t("trialBanner.buyLifetime")}
          </span>
        </div>
        <button
          type="button"
          onClick={handleBuy}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600"
        >
          {t("trialBanner.buyNow")}
          <ExternalLink size={12} />
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 rounded-md p-1 text-(--color-text-muted) transition-colors hover:bg-(--color-surface) hover:text-(--color-text)"
          aria-label={t("trialBanner.dismiss")}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
