import { AlertCircle, X } from "lucide-react";
import { useT } from "../../i18n";
import { useTimerStore } from "../../stores/timerStore";

/**
 * Timerens fejl som banner over de stadig synlige kontroller. Bruges også
 * uden for Timer-fanen (fx Start fra historikken), så en fejlet handling
 * aldrig forsvinder i en fane, brugeren ikke ser.
 */
export function TimerErrorBanner({ className = "" }: { className?: string }) {
  const { t } = useT();
  const error = useTimerStore((s) => s.error);
  const clearError = useTimerStore((s) => s.clearError);
  const fetchTimerState = useTimerStore((s) => s.fetchTimerState);

  if (!error) return null;

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg ${className}`}
      role="alert"
    >
      <AlertCircle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
      <p className="flex-1 text-xs text-red-700">{error}</p>
      <button
        type="button"
        onClick={() => fetchTimerState()}
        className="text-xs font-medium text-red-700 hover:underline flex-shrink-0"
      >
        {t("popup.queryError.retry")}
      </button>
      <button
        type="button"
        onClick={clearError}
        className="text-red-600 hover:text-red-800 flex-shrink-0"
        aria-label={t("popup.timerError.close")}
      >
        <X size={14} />
      </button>
    </div>
  );
}
