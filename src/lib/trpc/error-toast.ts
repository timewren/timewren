import { toast } from "sonner";
import { syncT } from "@/i18n/sync-text";
import { errorToastAction } from "./friendly-error";

/**
 * Fejl-toast til tRPC-kald med en handling: "Prøv igen" (når `onRetry` er
 * givet og fejlen er forbigående) eller "Log ind" (udløbet session).
 * Beskeden er allerede på brugerens sprog via friendlyErrorLink; `fallback` bruges kun,
 * hvis fejlen ingen besked har.
 */
export function toastError(
  error: unknown,
  fallback: string,
  onRetry?: () => void,
): void {
  const message =
    error instanceof Error && error.message ? error.message : fallback;
  const kind = errorToastAction(error);
  const locale =
    typeof document === "undefined" ? null : document.documentElement.lang;

  if (kind === "login") {
    toast.error(message, {
      action: {
        label: syncT("friendly.login", undefined, locale),
        onClick: () => {
          const here = `${window.location.pathname}${window.location.search}`;
          window.location.assign(`/login?redirect=${encodeURIComponent(here)}`);
        },
      },
    });
    return;
  }
  if (kind === "retry" && onRetry) {
    toast.error(message, {
      action: {
        label: syncT("friendly.retry", undefined, locale),
        onClick: onRetry,
      },
    });
    return;
  }
  toast.error(message);
}
