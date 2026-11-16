"use client";

import { Check, PenLine, Play, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { PRIMARY_USES, type PrimaryUse } from "@/lib/onboarding/activation";
import { trpc } from "@/providers/trpc-provider";
import { isGenuinePause, useTimerStore } from "@/stores/timerStore";

export const WELCOME_BANNER_KEY = "welcome-first-timer";

/**
 * Velkomstkortet på Hjem (#91, timer-first): ét tydeligt første skridt —
 * start en timer eller skriv en linje i feltet — og et valgfrit spørgsmål,
 * der tilpasser Hjems signaler. Kan lukkes; lukningen gemmes server-side.
 */
export function HomeWelcome({
  showFirstTimer,
  showSurvey,
  primaryUse,
}: {
  showFirstTimer: boolean;
  showSurvey: boolean;
  primaryUse: PrimaryUse | null;
}) {
  const t = useTranslations("home.welcome");
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const utils = trpc.useUtils();
  const isRunning = useTimerStore((s) => s.isRunning);
  const paused = useTimerStore((s) => isGenuinePause(s));
  const startTimer = useTimerStore((s) => s.startTimer);
  const busy = isRunning || paused;

  const dismiss = trpc.user.dismissBanner.useMutation({
    onSuccess: () => {
      utils.user.getDismissedBanners.invalidate();
      utils.user.getProfile.invalidate();
    },
  });
  const setPrimaryUse = trpc.onboarding.setPrimaryUse.useMutation({
    onSuccess: (res) => {
      // Kortet kan forsvinde med svaret (når der allerede er tid), så
      // kvitteringen gives også som toast
      if (res.primaryUse) toast.success(t("thanksToast"));
      utils.onboarding.activationStatus.invalidate();
    },
    onError: () => toast.error(t("saveFailed")),
  });

  const focusPrompt = () => {
    const input = document.querySelector<HTMLInputElement>(
      '[data-tour="hjem-prompt"] input',
    );
    input?.focus();
    input?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <section
      aria-labelledby="hjem-velkomst"
      className="relative rounded-xl border border-brand-200 bg-brand-50/60 p-4 sm:p-5 dark:border-brand-600 dark:bg-tt-gran-lys"
    >
      <button
        type="button"
        onClick={() => dismiss.mutate({ key: WELCOME_BANNER_KEY })}
        disabled={dismiss.isPending}
        aria-label={t("hide")}
        className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-brand-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-tt-gran-lys dark:hover:text-white"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      <h2
        id="hjem-velkomst"
        className="pr-12 text-base font-semibold text-gray-900 dark:text-white"
      >
        {showFirstTimer ? t("title", { brand: brand.name }) : t("titleDone")}
      </h2>

      {showFirstTimer && (
        <>
          <p className="mt-1 max-w-prose text-sm text-gray-700 dark:text-gray-300">
            {t("intro")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                startTimer({});
                toast.success(t("timerStarted"));
              }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-tt-gran px-4 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-gray-900"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              {busy ? t("timerBusy") : t("startFirstTimer")}
            </button>
            <button
              type="button"
              onClick={focusPrompt}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <PenLine className="h-4 w-4" aria-hidden="true" />
              {t("writeLine")}
            </button>
          </div>
        </>
      )}

      {(showSurvey || primaryUse) && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-gray-900 dark:text-white">
            {t.rich("surveyQuestion", {
              brand: brand.name,
              muted: (chunks) => (
                <span className="font-normal text-gray-600 dark:text-gray-400">
                  {chunks}
                </span>
              ),
            })}
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRIMARY_USES.map((use) => {
              const selected = primaryUse === use;
              return (
                <button
                  key={use}
                  type="button"
                  aria-pressed={selected}
                  disabled={setPrimaryUse.isPending}
                  onClick={() =>
                    setPrimaryUse.mutate({
                      primaryUse: selected ? null : use,
                    })
                  }
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60 ${
                    selected
                      ? "border-brand-600 bg-tt-gran text-tt-paa-gran"
                      : "border-gray-300 bg-white text-gray-800 hover:border-brand-300 hover:bg-brand-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-brand-600 dark:hover:bg-tt-gran-lys"
                  }`}
                >
                  {selected && <Check className="h-4 w-4" aria-hidden="true" />}
                  {t(`primaryUse.${use}`)}
                </button>
              );
            })}
          </div>
          <p
            className="mt-2 text-xs text-gray-600 dark:text-gray-400"
            aria-live="polite"
          >
            {primaryUse ? t("thanksNote") : t("privacyNote")}
          </p>
        </fieldset>
      )}
    </section>
  );
}
