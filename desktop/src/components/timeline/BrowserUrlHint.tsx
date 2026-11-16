import { Globe, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { tauriInvoke } from "@/lib/tauri";
import { toast } from "@/stores/toastStore";

/** Look-back window (days) and the threshold that makes the tip worth showing. */
const WINDOW_DAYS = 7;
const MIN_COUNT = 20;

/**
 * Discreet, dismissible tip nudging the user to enable the opt-in
 * `browser_url_capture` setting when many browser activities go unclassified.
 *
 * It is intentionally unobtrusive and appears only when ALL hold:
 *  1. `browser_url_capture` is OFF (we never change the privacy default),
 *  2. there are ≥ MIN_COUNT unclassified browser activities in the window, and
 *  3. the user has not dismissed it before (`browser_url_hint_dismissed`).
 *
 * One count query on mount, no polling.
 */
export function BrowserUrlHint() {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const [capture, dismissed] = await Promise.all([
          tauriInvoke<string | null>("get_setting", {
            key: "browser_url_capture",
          }),
          tauriInvoke<string | null>("get_setting", {
            key: "browser_url_hint_dismissed",
          }),
        ]);
        // Only when capture is OFF and the tip was never dismissed.
        if (capture === "true" || dismissed === "true") return;

        const n = await tauriInvoke<number>(
          "count_unclassified_browser_activities",
          { days: WINDOW_DAYS },
        );
        if (!cancelled && n >= MIN_COUNT) {
          setCount(n);
          setVisible(true);
        }
      } catch {
        // Non-critical hint — stay silent on failure.
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setVisible(false);
    try {
      await tauriInvoke("set_setting", {
        key: "browser_url_capture",
        value: "true",
      });
      toast.success(t("timeline.browserHint.enabled"));
    } catch {
      toast.error(t("timeline.browserHint.enableFailed"));
      setVisible(true);
    }
  }

  async function handleDismiss() {
    setVisible(false);
    try {
      await tauriInvoke("set_setting", {
        key: "browser_url_hint_dismissed",
        value: "true",
      });
    } catch {
      // If persisting fails the tip simply reappears next session — acceptable.
    }
  }

  if (!visible) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-(--color-accent)/30 bg-(--color-accent)/5 px-4 py-3">
      <Globe size={16} className="mt-0.5 shrink-0 text-(--color-accent)" />
      <div className="flex-1 space-y-2">
        <p className="text-sm text-(--color-text)">
          {t("timeline.browserHint.message", { count })}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleEnable}>
            {t("timeline.browserHint.enable")}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDismiss}>
            {t("timeline.browserHint.dismiss")}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t("timeline.browserHint.dismiss")}
        className="shrink-0 text-(--color-text-muted) transition-colors hover:text-(--color-text)"
      >
        <X size={14} />
      </button>
    </div>
  );
}
