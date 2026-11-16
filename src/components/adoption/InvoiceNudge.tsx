"use client";

import { Receipt, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { NudgeSurface } from "@/lib/adoption/nudges";
import { formatCurrency, formatTimeHuman } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { InvoiceNowDialog } from "./InvoiceNowDialog";
import { useNudgeEligibility, useNudgeTracking } from "./useNudges";

/**
 * Kontekstuelt, afviseligt "Fakturér nu"-nudge (#89). Vises kun når en kunde
 * har mindst 5 ufakturerede timer OG der er gået mindst 30 dage siden sidste
 * faktura (eller ældste ufakturerede post) — se `lib/adoption/nudges.ts`.
 *
 * Med `clientId` gælder det den ene kunde (kundesiden); uden vises den kunde
 * med størst ufaktureret værdi (dashboard / Hjem-signaler). Rendrer intet når
 * der ikke er noget at handle på, så komponenten kan sættes ind hvor som helst.
 */
export function InvoiceNudge({
  clientId,
  surface,
  className = "",
}: {
  clientId?: string;
  surface: NudgeSurface;
  className?: string;
}) {
  const t = useTranslations("billing.adoption.invoiceNudge");
  const eligible = useNudgeEligibility().invoicing;
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data } = trpc.invoices.nudgeCandidates.useQuery(
    { clientId, limit: 1 },
    { enabled: eligible },
  );
  const nudge = eligible ? data?.[0] : undefined;
  const trackClick = useNudgeTracking("invoice", surface, nudge?.clientId);

  const dismiss = trpc.nudges.dismiss.useMutation({
    onSuccess: () => utils.invoices.nudgeCandidates.invalidate(),
  });

  if (!nudge) return null;

  const sinceText =
    nudge.since === "last_invoice"
      ? t("sinceLastInvoice", { count: nudge.daysSince })
      : t("oldestEntry", { count: nudge.daysSince });

  return (
    <>
      <section
        aria-label={t("ready")}
        className={`flex flex-col gap-3 rounded-xl border border-gray-200/80 bg-white p-3 sm:flex-row sm:items-center dark:border-gray-800 dark:bg-gray-900 ${className}`}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Receipt
            className="mt-0.5 h-4 w-4 shrink-0 text-brand-700 dark:text-brand-400"
            aria-hidden="true"
          />
          <p className="text-sm text-gray-800 dark:text-gray-200">
            <span className="font-medium tabular-nums">
              {formatTimeHuman(nudge.hours)}
            </span>
            {nudge.value > 0 && (
              <span className="tabular-nums">
                {" "}
                ({formatCurrency(nudge.value)})
              </span>
            )}{" "}
            {clientId
              ? t("notInvoiced")
              : t("notInvoicedClient", { client: nudge.clientName })}
            <span className="text-gray-500 dark:text-gray-400">
              {" "}
              · {sinceText}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
          <Button
            size="sm"
            onClick={() => {
              trackClick();
              setDialogOpen(true);
            }}
          >
            {t("invoiceNow")}
          </Button>
          <button
            type="button"
            onClick={() =>
              dismiss.mutate({
                nudge: "invoice",
                surface,
                clientId: nudge.clientId,
              })
            }
            disabled={dismiss.isPending}
            className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label={t("hide")}
            title={t("hide")}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>
      <InvoiceNowDialog
        clientId={nudge.clientId}
        clientName={nudge.clientName}
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        origin="invoice_nudge"
      />
    </>
  );
}
