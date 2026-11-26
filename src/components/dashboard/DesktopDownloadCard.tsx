"use client";

import { Apple, Download, Monitor, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useBrand } from "@/components/BrandContext";
import { useLatestDesktopRelease } from "@/components/desktop/useLatestDesktopRelease";
import { trpc } from "@/providers/trpc-provider";

const BANNER_KEY = "desktop-download";

export function DesktopDownloadCard() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("dashboard.desktopCard");
  // Delt hook med app-draweren og indstillingssiden — samme fetch, samme
  // localStorage-cache, ét sted at rette.
  const { loaded, os, version, winUrl, macUrl, hasDownloads } =
    useLatestDesktopRelease();

  const utils = trpc.useUtils();
  const { data: dismissed, isLoading: dismissedLoading } =
    trpc.user.getDismissedBanners.useQuery(undefined, {
      staleTime: 5 * 60 * 1000,
    });
  const dismissMutation = trpc.user.dismissBanner.useMutation({
    onSuccess: () => utils.user.getDismissedBanners.invalidate(),
  });
  const isDismissed = dismissed?.includes(BANNER_KEY) ?? false;

  const linkClass =
    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors";
  const primary = `${linkClass} bg-tt-gran text-tt-paa-gran hover:bg-tt-gran-moerk`;
  const secondary = `${linkClass} border border-brand-200 text-brand-700 hover:bg-brand-100 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-tt-gran-lys`;

  const winButton = winUrl ? (
    <a
      key="win"
      href={winUrl}
      className={os === "windows" || os === "other" ? primary : secondary}
    >
      <Monitor className="h-4 w-4" />
      Windows
    </a>
  ) : null;

  const macButton = macUrl ? (
    <a key="mac" href={macUrl} className={os === "macos" ? primary : secondary}>
      <Apple className="h-4 w-4" />
      macOS
    </a>
  ) : null;

  // Put the detected platform's button first.
  const buttons =
    os === "macos" ? [macButton, winButton] : [winButton, macButton];

  // Render nothing until we know the release state — avoids flashing the
  // "Download er på vej" fallback before the fetch resolves. Skjul også hvis
  // brugeren har afvist kortet (server-husket, på tværs af enheder).
  if (!loaded || dismissedLoading || isDismissed) return null;

  return (
    <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Download className="h-5 w-5 shrink-0 text-tt-graa" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-brand-900 dark:text-brand-100">
              {brand.name} Desktop
            </p>
            <p className="text-xs text-brand-700/80 dark:text-brand-300/80">
              {hasDownloads
                ? t("withDownloads", {
                    version: version ? t("version", { version }) : "",
                  })
                : t("withoutDownloads", { brand: brand.name })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasDownloads && buttons}
          <button
            type="button"
            onClick={() => dismissMutation.mutate({ key: BANNER_KEY })}
            disabled={dismissMutation.isPending}
            className="rounded-md p-1 text-brand-400 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 transition-colors disabled:opacity-50"
            aria-label={t("hide")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {hasDownloads && (
        <p className="mt-2 text-[11px] text-brand-700/70 dark:text-brand-300/70">
          {t("reportHint")}
        </p>
      )}
    </div>
  );
}
