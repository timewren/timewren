"use client";

import { ArrowRight, Check, Clock, Rocket } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { trpc } from "@/providers/trpc-provider";

const STEPS = [
  { key: "hasClient", href: "/dashboard/clients" },
  { key: "hasTimeEntry", href: "/dashboard/time" },
  { key: "hasKlippekort", href: "/dashboard/klippekort" },
  { key: "hasInvoice", href: "/dashboard/invoices" },
] as const;

const CHECKLIST_KEY = "onboarding-checklist";

/**
 * Trial-nedtælling + aktiverings-checklist på dashboardet.
 *
 * Checklisten vises for ALLE brugere der endnu ikke har gennemført
 * aktiverings-trinnene (#183) — også inviterede medlemmer i betalte orgs,
 * gratis adgang og manuelle abonnementer, som før aldrig så den.
 * Trial-nedtællingen (+ betalings-CTA) er fortsat kun for trials.
 *
 * Best practice: "Opret din konto" er et gratis, allerede fuldført første
 * punkt (synlig quick win), og en progres-bar viser fremdriften. Skjules
 * server-side (users.dismissedBanners), og forsvinder selv når alt er done.
 */
export function TrialActivationBanner({
  hideChecklist = false,
}: {
  /** Hjem viser velkomstkortet i stedet, indtil første tidspost (#91). */
  hideChecklist?: boolean;
} = {}) {
  const t = useTranslations("dashboard.trial");
  const { data: details } = trpc.subscription.getDetails.useQuery(undefined, {
    staleTime: 60_000,
  });
  const isTrialing = details?.status === "trialing";

  const { data: activation } = trpc.onboarding.activationStatus.useQuery(
    undefined,
    { staleTime: 60_000 },
  );

  const utils = trpc.useUtils();
  const { data: dismissed } = trpc.user.getDismissedBanners.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 },
  );
  const dismissMutation = trpc.user.dismissBanner.useMutation({
    onSuccess: () => utils.user.getDismissedBanners.invalidate(),
  });
  const checklistDismissed = dismissed?.includes(CHECKLIST_KEY) ?? false;

  const doneCount = activation
    ? STEPS.filter((s) => activation[s.key]).length
    : 0;
  const allDone = activation ? doneCount === STEPS.length : false;

  // Vent på dismissal-listen før checklisten vises — ellers blinker den
  // frem for brugere der allerede har skjult den, indtil querien lander.
  const showChecklist =
    !hideChecklist &&
    !!activation &&
    dismissed !== undefined &&
    !allDone &&
    !checklistDismissed;
  const showTrialBar = !!details && isTrialing;

  if (!showTrialBar && !showChecklist) return null;

  // Inkl. det gratis "Opret din konto"-punkt (altid fuldført)
  const totalSteps = STEPS.length + 1;
  const totalDone = doneCount + 1;
  const progressPct = Math.round((totalDone / totalSteps) * 100);

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 dark:border-brand-600 dark:bg-tt-gran-lys">
      {showTrialBar && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 shrink-0 text-tt-graa" />
            <p className="font-medium text-brand-900 dark:text-brand-300">
              {t("daysLeft", { count: details.trialDaysRemaining })}
            </p>
          </div>
          <Link
            href="/dashboard/settings/subscription"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
          >
            {t("addPayment")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {showChecklist && (
        <div
          className={
            showTrialBar
              ? "mt-4 border-t border-brand-200 pt-3 dark:border-brand-600"
              : ""
          }
        >
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-brand-700 dark:text-brand-400">
              <Rocket className="h-3.5 w-3.5" />
              {t("gettingStarted", { done: totalDone, total: totalSteps })}
            </p>
            <button
              type="button"
              onClick={() => dismissMutation.mutate({ key: CHECKLIST_KEY })}
              disabled={dismissMutation.isPending}
              className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
            >
              {t("hide")}
            </button>
          </div>

          {/* Progres-bar */}
          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-brand-100 dark:bg-tt-gran-lys"
            role="progressbar"
            aria-label={t("progressLabel")}
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-all dark:bg-brand-400"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {/* Gratis quick win — altid fuldført */}
            <li>
              <span className="flex items-center gap-2 text-sm text-brand-700 line-through dark:text-brand-400">
                <Check className="h-4 w-4 shrink-0 text-green-600" />
                {t("createAccount")}
              </span>
            </li>
            {STEPS.map((step) => {
              const done = activation[step.key];
              return (
                <li key={step.key}>
                  {done ? (
                    <span className="flex items-center gap-2 text-sm text-brand-700 line-through dark:text-brand-400">
                      <Check className="h-4 w-4 shrink-0 text-green-600" />
                      {t(`step.${step.key}`)}
                    </span>
                  ) : (
                    <Link
                      href={step.href}
                      className="flex items-center gap-2 text-sm text-brand-900 hover:underline dark:text-brand-300"
                    >
                      <span className="h-4 w-4 shrink-0 rounded-full border-2 border-brand-400" />
                      {t(`step.${step.key}`)}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
