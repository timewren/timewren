"use client";

import { Download, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useBrand } from "@/components/BrandContext";
import { usePwaInstall } from "@/hooks/usePwaInstall";

/**
 * PWA Install Prompt Component
 *
 * Shows an install prompt for users who haven't installed the PWA yet.
 * Only shows after user has been active for 30 seconds.
 *
 * Selve prompt-eventet ejes af usePwaInstall, som app-draweren deler — det
 * må kun bruges én gang, så to uafhængige lyttere ville give InvalidStateError.
 */
export function PWAInstallPrompt() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("shell.pwa");
  const { canInstall, isInstalled, install } = usePwaInstall();
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (!canInstall || isInstalled) return;

    // Check if user has dismissed the prompt before
    const dismissed = localStorage.getItem("pwa-install-dismissed");
    if (dismissed) {
      const dismissedTime = Number.parseInt(dismissed, 10);
      const daysSinceDismissed =
        (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
      // Show again after 7 days
      if (daysSinceDismissed < 7) {
        return;
      }
    }

    // Show prompt after 30 seconds of being logged in
    const timeoutId = setTimeout(() => setShowPrompt(true), 30000);
    return () => clearTimeout(timeoutId);
  }, [canInstall, isInstalled]);

  async function handleInstallClick() {
    const outcome = await install();
    console.log(`[PWA] User ${outcome} the install prompt`);
    setShowPrompt(false);
  }

  function handleDismiss() {
    setShowPrompt(false);
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
  }

  if (isInstalled || !showPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-[4.5rem] left-4 right-4 z-50 mx-auto max-w-md lg:left-auto lg:right-8 lg:bottom-8">
      <div className="rounded-lg bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 rounded-lg bg-brand-100 dark:bg-tt-gran-lys p-3">
            <Download className="h-6 w-6 text-brand-600 dark:text-brand-400" />
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
              {t("installTitle", { brand: brand.name })}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              {t("installBody")}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleInstallClick}
                className="flex-1 rounded-lg bg-tt-gran px-4 py-3 min-h-[44px] text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk transition-colors"
              >
                {t("install")}
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="rounded-lg px-4 py-3 min-h-[44px] text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                {t("notNow")}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            className="flex-shrink-0 flex items-center justify-center rounded-lg h-11 w-11 min-h-[44px] min-w-[44px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Luk"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
