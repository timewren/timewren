import { Crosshair } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { tauriInvoke } from "@/lib/tauri";

interface DerivedContext {
  path: string | null;
  label: string | null;
}

const COUNTDOWN_SECONDS = 4;

/**
 * On-device diagnostic for the project-context detection. Because the detector
 * reads the FOREGROUND window, a countdown lets the user switch to the app they
 * want to test (e.g. Orca) before the snapshot is taken.
 */
export function ContextDiagnostics() {
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState(0);
  const [result, setResult] = useState<DerivedContext | null>(null);
  const [ran, setRan] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function runTest() {
    if (countdown > 0) return;
    setResult(null);
    setRan(false);
    let remaining = COUNTDOWN_SECONDS;
    setCountdown(remaining);

    timerRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        tauriInvoke<DerivedContext>("get_active_context")
          .then((r) => {
            setResult(r);
            setRan(true);
          })
          .catch(() => {
            setResult(null);
            setRan(true);
          });
      }
    }, 1000);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={runTest}
        disabled={countdown > 0}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-(--color-border) bg-(--color-surface) px-3 text-xs font-medium text-(--color-text) transition-colors hover:bg-(--color-border)/50 disabled:opacity-60"
      >
        <Crosshair size={14} />
        {countdown > 0
          ? `${t("privacy.contextSwitchToApp")} ${countdown}`
          : t("privacy.contextTestButton")}
      </button>

      {ran && (
        <div className="rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-2 text-xs">
          {result?.path ? (
            <>
              <p className="text-(--color-text)">
                {t("privacy.contextProject")}{" "}
                <span className="font-medium">
                  {result.label ?? result.path}
                </span>
              </p>
              <p className="mt-0.5 break-all font-mono text-(--color-text-muted)">
                {result.path}
              </p>
            </>
          ) : (
            <p className="text-(--color-text-muted)">
              {t("privacy.contextNotFound")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
