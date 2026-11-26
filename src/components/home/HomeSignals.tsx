"use client";

import { ArrowRight, Receipt, Ticket } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatDuration } from "@/lib/format";
import { activationNudge } from "@/lib/onboarding/activation";
import { trpc } from "@/providers/trpc-provider";

/** Under så mange ufakturerede timer er det ikke værd at nævne på Hjem */
const UNBILLED_MIN_HOURS = 1;

/**
 * Diskrete signaler (#89/#90): kun når der er noget at handle på, og kun på
 * planer med fakturering/klippekort. Ingen tomme kort, ingen alarmfarver —
 * de store advarsler bor på Overblik og klippekort-siden.
 */
export function HomeSignals({
  showKlippekort,
  showInvoicing,
  showClients,
  canManageTeam,
}: {
  showKlippekort: boolean;
  showInvoicing: boolean;
  showClients: boolean;
  canManageTeam: boolean;
}) {
  const t = useTranslations("home.signals");
  const tHome = useTranslations("home");
  const units = {
    h: tHome("duration.hourUnit"),
    min: tHome("duration.minUnit"),
  };
  const { data: lowBalance } = trpc.prepaid.getLowBalance.useQuery(
    {},
    { enabled: showKlippekort },
  );
  const { data: unbilled } = trpc.time.unbilledStats.useQuery(undefined, {
    enabled: showInvoicing,
  });

  // Næste skridt ud fra velkomstspørgsmålet (#91) — deterministisk
  const { data: activation } = trpc.onboarding.activationStatus.useQuery(
    undefined,
    { staleTime: 60_000 },
  );
  const nudge = activation
    ? activationNudge({
        primaryUse: activation.primaryUse,
        facts: activation,
        showInvoicing,
        showKlippekort,
        showClients,
        canManageTeam,
      })
    : null;

  const lowCount = showKlippekort ? (lowBalance?.length ?? 0) : 0;
  const unbilledHours = showInvoicing ? (unbilled?.hours ?? 0) : 0;
  const showUnbilled = unbilledHours >= UNBILLED_MIN_HOURS;

  if (lowCount === 0 && !showUnbilled && !nudge) return null;

  return (
    <section
      aria-label={t("label")}
      className="space-y-1 rounded-xl border border-gray-200/80 bg-white p-2 dark:border-gray-800 dark:bg-gray-900"
    >
      {nudge && (
        <Link
          href={nudge.href}
          className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <ArrowRight
            className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400"
            aria-hidden="true"
          />
          <span>{t(`nudge.${nudge.key}`)}</span>
        </Link>
      )}
      {lowCount > 0 && (
        <Link
          href="/dashboard/klippekort"
          className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <Ticket
            className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
            aria-hidden="true"
          />
          <span>{t("lowBalance", { count: lowCount })}</span>
        </Link>
      )}
      {showUnbilled && (
        <Link
          href="/dashboard/invoices"
          className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <Receipt
            className="h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400"
            aria-hidden="true"
          />
          <span>
            {t.rich("unbilled", {
              duration: formatDuration(unbilledHours, units),
              b: (chunks) => (
                <span className="font-medium tabular-nums">{chunks}</span>
              ),
            })}
          </span>
        </Link>
      )}
    </section>
  );
}
