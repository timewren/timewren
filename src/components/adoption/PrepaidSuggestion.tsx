"use client";

import { Ticket, X } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import type { NudgeSurface } from "@/lib/adoption/nudges";
import { formatCurrency, formatTimeHuman } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { useNudgeEligibility, useNudgeTracking } from "./useNudges";

type Candidate = {
  clientId: string;
  clientName: string;
  hours: number;
  hourlyRate: number | null;
  totalPrice: number | null;
  avgMonthlyHours: number;
  monthsCovered: number;
};

/** Link til klippekort-formularen med forslaget forudfyldt. */
export function prepaidSuggestionHref(
  c: Candidate,
  defaultName: string,
): string {
  const params = new URLSearchParams({
    clientId: c.clientId,
    hours: String(c.hours),
    name: defaultName,
  });
  if (c.hourlyRate) params.set("rate", String(c.hourlyRate));
  return `/dashboard/klippekort/new?${params.toString()}`;
}

function SuggestionRow({
  candidate,
  surface,
  showClientName,
}: {
  candidate: Candidate;
  surface: NudgeSurface;
  showClientName: boolean;
}) {
  const t = useTranslations("billing.adoption.prepaid");
  const intlLocale = toIntlLocale(useLocale());
  const utils = trpc.useUtils();
  const trackClick = useNudgeTracking("prepaid", surface, candidate.clientId);
  const dismiss = trpc.nudges.dismiss.useMutation({
    onSuccess: () => utils.prepaid.suggestions.invalidate(),
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-200/80 bg-white p-3 sm:flex-row sm:items-center dark:border-gray-800 dark:bg-gray-900">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Ticket
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
          aria-hidden="true"
        />
        <p className="text-sm text-gray-800 dark:text-gray-200">
          {showClientName
            ? t.rich("usageClient", {
                client: candidate.clientName,
                time: formatTimeHuman(candidate.avgMonthlyHours),
                name: (chunks) => <span className="font-medium">{chunks}</span>,
                num: (chunks) => <span className="tabular-nums">{chunks}</span>,
              })
            : t.rich("usageGeneric", {
                time: formatTimeHuman(candidate.avgMonthlyHours),
                num: (chunks) => <span className="tabular-nums">{chunks}</span>,
              })}{" "}
          <span className="text-gray-500 dark:text-gray-400">
            {candidate.totalPrice !== null
              ? t("offerPrice", {
                  hours: candidate.hours,
                  price: formatCurrency(candidate.totalPrice),
                  months: candidate.monthsCovered.toLocaleString(intlLocale),
                })
              : t("offer", {
                  hours: candidate.hours,
                  months: candidate.monthsCovered.toLocaleString(intlLocale),
                })}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
        <Link
          href={prepaidSuggestionHref(
            candidate,
            t("defaultName", { hours: candidate.hours }),
          )}
          onClick={trackClick}
          className="inline-flex items-center rounded-lg bg-tt-gran px-2.5 py-1 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          {t("sell")}
        </Link>
        <button
          type="button"
          onClick={() =>
            dismiss.mutate({
              nudge: "prepaid",
              surface,
              clientId: candidate.clientId,
            })
          }
          disabled={dismiss.isPending}
          className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          aria-label={t("dismissLabel", { client: candidate.clientName })}
          title={t("dismissTitle")}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * Klippekort-discovery (#90): "Sælg et klippekort til <kunde>" for kunder
 * uden aktivt klippekort, der har fast, mindre månedlig tid. Forslaget
 * (timer/pris) er udregnet deterministisk ud fra de sidste 3 måneders tid —
 * se `lib/adoption/nudges.ts`. Rendrer intet uden kandidater.
 */
export function PrepaidSuggestion({
  clientId,
  surface,
  limit = 1,
  className = "",
}: {
  clientId?: string;
  surface: NudgeSurface;
  limit?: number;
  className?: string;
}) {
  const t = useTranslations("billing.adoption.prepaid");
  const eligible = useNudgeEligibility().klippekort;
  const { data } = trpc.prepaid.suggestions.useQuery(
    { clientId, limit },
    { enabled: eligible },
  );
  if (!eligible || !data || data.length === 0) return null;

  return (
    <section
      aria-label={t("suggestionLabel")}
      className={`space-y-2 ${className}`}
    >
      {data.map((candidate) => (
        <SuggestionRow
          key={candidate.clientId}
          candidate={candidate}
          surface={surface}
          showClientName={!clientId}
        />
      ))}
    </section>
  );
}
