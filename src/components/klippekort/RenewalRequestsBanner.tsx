"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { usePermission } from "@/hooks/usePermission";
import { trpc } from "@/providers/trpc-provider";

/** Genkøbs-anmodninger fra portalen (#80): godkend/afvis med ét klik */
export function RenewalRequestsBanner() {
  const t = useTranslations("klippekort.list.renewal");
  const utils = trpc.useUtils();
  const { data: requests } = trpc.prepaid.listRenewalRequests.useQuery();
  const { canWrite: canWriteInvoices } = usePermission("invoices");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [failedInvoiceId, setFailedInvoiceId] = useState<string | null>(null);
  const resolveMutation = trpc.prepaid.resolveRenewalRequest.useMutation();
  const sendMutation = trpc.invoices.sendEmail.useMutation();

  async function resolve(requestId: string, approve: boolean, sendNow = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let invoiceId: string | null = null;
    try {
      const result = await resolveMutation.mutateAsync({ requestId, approve });
      invoiceId = result.invoiceId;
      if (!result.approved) {
        toast.success(t("rejected"));
      } else if (!invoiceId) {
        toast.success(t("approvedNoInvoice"));
      } else if (sendNow) {
        await sendMutation.mutateAsync({ id: invoiceId });
        toast.success(t("approvedSent"));
      } else {
        toast.success(t("approved"));
      }
    } catch (error) {
      if (invoiceId) setFailedInvoiceId(invoiceId);
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      utils.prepaid.invalidate();
      utils.invoices.invalidate();
      inFlight.current = false;
      setBusy(false);
    }
  }

  if ((!requests || requests.length === 0) && !failedInvoiceId) return null;

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-600 dark:bg-tt-gran-lys">
      {failedInvoiceId && (
        <p
          role="alert"
          className="mb-2 text-sm text-gray-900 dark:text-gray-100"
        >
          {t("sendFailed")}{" "}
          <Link
            className="underline"
            href={`/dashboard/invoices/${failedInvoiceId}`}
          >
            {t("openInvoice")}
          </Link>
        </p>
      )}
      <p className="text-sm font-semibold text-brand-900 dark:text-brand-300">
        {t("banner", { count: requests?.length ?? 0 })}
      </p>
      <ul className="mt-2 space-y-2">
        {requests?.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm dark:bg-gray-900"
          >
            <span className="text-gray-900 dark:text-gray-100">
              {t.rich("wants", {
                client: r.client?.name ?? "",
                package: r.prepaidPackage?.name ?? "",
                b: (chunks) => <strong>{chunks}</strong>,
              })}
              {r.message ? t("withMessage", { message: r.message }) : ""}
            </span>
            <span className="flex flex-wrap gap-2">
              {canWriteInvoices && (
                <button
                  type="button"
                  onClick={() => resolve(r.id, true, true)}
                  disabled={busy}
                  className="min-h-11 rounded-lg bg-tt-gran px-3 py-1.5 text-xs font-semibold text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
                >
                  {t("approveAndSend")}
                </button>
              )}
              <button
                type="button"
                onClick={() => resolve(r.id, true)}
                disabled={busy}
                className="rounded-lg bg-tt-gran px-3 py-1.5 text-xs font-semibold text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
              >
                {t("approve")}
              </button>
              <button
                type="button"
                onClick={() => resolve(r.id, false)}
                disabled={busy}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {t("reject")}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
