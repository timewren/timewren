"use client";

import * as Sentry from "@sentry/nextjs";
import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { isChunkLoadError, reloadOnChunkError } from "@/lib/pwa/chunk-reload";

/**
 * Fejlside for dashboardets ruter (error.tsx i hver rute re-eksporterer
 * den). Ruten fejler inde i sit eget layout, så sidemenu, topbar og fx
 * indstillingernes undermenu bliver stående.
 */
export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("shell.route");
  useEffect(() => {
    // Et nyt deploy har fjernet det gamle builds chunks: genindlæs én gang.
    if (reloadOnChunkError(error)) return;
    Sentry.captureException(error);
  }, [error]);

  // reset() henter den samme manglende chunk igen; kun en genindlæsning hjælper.
  const retry = isChunkLoadError(error)
    ? () => window.location.reload()
    : reset;

  return (
    <div className="flex min-h-[60vh] items-center px-4 py-12 text-tt-blaek">
      <div className="mx-auto w-full max-w-xl">
        <p className="text-sm font-medium text-tt-graa">{t("errorLabel")}</p>
        <h1 className="mt-2 text-3xl font-bold leading-[1.1] tracking-[-0.035em]">
          {t("errorTitle")}
        </h1>
        <p className="mt-4 max-w-[60ch] leading-relaxed text-tt-graa">
          {t("errorBody")}
        </p>
        {error.digest && (
          <p className="mt-3 text-xs text-tt-graa">
            {t.rich("errorId", {
              id: error.digest,
              b: (chunks) => <span className="tabular-nums">{chunks}</span>,
            })}
          </p>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-tt-gran px-5 font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t("retry")}
          </button>
          <Link
            href="/contact"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-tt-kant px-5 font-medium hover:bg-tt-flade"
          >
            {t("writeToMe")}
          </Link>
        </div>
      </div>
    </div>
  );
}
