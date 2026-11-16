"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { AutoSaveStatus as Status } from "@/lib/auto-save";
import { useUiText } from "./use-ui-text";

/**
 * Diskret status for et kort, der gemmer sig selv: "Gemmer …", "Gemt"
 * (forsvinder efter 2 s) eller "Kunne ikke gemme" med "Prøv igen".
 * `blocked`: formularen gemmes samlet og venter på, at et ugyldigt felt
 * bliver rettet.
 * Regionen er altid i DOM'en, så skærmlæsere hører skiftene.
 */
export function AutoSaveStatus({
  status,
  onRetry,
  blocked = false,
  className = "",
}: {
  status: Status;
  onRetry?: () => void;
  blocked?: boolean;
  className?: string;
}) {
  const t = useUiText();
  const shown = blocked && status !== "saving" ? "blocked" : status;
  return (
    <div
      aria-live="polite"
      data-testid="autosave-status"
      data-status={shown}
      className={`flex min-h-5 items-center gap-1.5 text-xs ${className}`}
    >
      {shown === "saving" && (
        <span className="inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {t("autosave.saving")}
        </span>
      )}
      {shown === "saved" && (
        <span className="inline-flex items-center gap-1.5 text-green-700 dark:text-green-400">
          <Check className="h-3.5 w-3.5" aria-hidden />
          {t("autosave.saved")}
        </span>
      )}
      {shown === "blocked" && (
        <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          {t("autosave.blocked")}
        </span>
      )}
      {shown === "error" && (
        <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-400">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden />
          {t("autosave.failed")}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              {t("autosave.retry")}
            </button>
          )}
        </span>
      )}
    </div>
  );
}
