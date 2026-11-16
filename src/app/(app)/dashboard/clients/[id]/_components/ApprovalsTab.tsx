"use client";

import { Check, Clock, Loader2, Send, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { usePermission } from "@/hooks/usePermission";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  // Lokal dato — toISOString() gav gårsdagens dato mellem midnat og 02.
  return toLocalDateStr(d);
}

const STATUS_META: Record<
  string,
  { className: string; icon: React.ElementType }
> = {
  pending: {
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    icon: Clock,
  },
  approved: {
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    icon: Check,
  },
  rejected: {
    className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    icon: X,
  },
};

export function ApprovalsTab({ clientId }: { clientId: string }) {
  const t = useTranslations("clients");
  const locale = useLocale();
  const { canWrite } = usePermission("invoices");
  const utils = trpc.useUtils();

  const [periodStart, setPeriodStart] = useState(isoDaysAgo(30));
  const [periodEnd, setPeriodEnd] = useState(isoDaysAgo(0));

  const { data: requests, isLoading } = trpc.approvalRequests.list.useQuery({
    clientId,
  });

  const invalidate = () => {
    utils.approvalRequests.list.invalidate();
    utils.time.list.invalidate();
    // Posternes approvalStatus skifter (pending ↔ not_required) → ufaktureret-
    // listerne filtrerer på den, så de skal også genhentes (5 min staleTime).
    utils.invoices.getUninvoicedTimeEntries.invalidate();
    utils.invoices.getUninvoicedSummary.invalidate();
  };

  const createMutation = trpc.approvalRequests.create.useMutation({
    onSuccess: (res) => {
      invalidate();
      if (res.notified > 0) {
        toast.success(t("approvals.sentWithNotify", { count: res.entryCount }));
      } else if (!res.hasPortalContact) {
        toast.warning(t("approvals.noPortalContact"));
      } else {
        toast.success(t("approvals.sent", { count: res.entryCount }));
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const cancelMutation = trpc.approvalRequests.cancel.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success(t("approvals.cancelled"));
    },
    onError: (err) => toast.error(err.message),
  });

  if (!canWrite) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
        {t("approvals.noAccess")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Send ny anmodning */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          {t("approvals.sendTitle")}
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("approvals.sendDescription")}
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("approvals.from")}
            </span>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t("approvals.to")}
            </span>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </label>
          <button
            type="button"
            disabled={createMutation.isPending || periodStart > periodEnd}
            onClick={() =>
              createMutation.mutate({
                clientId,
                type: "period",
                periodStart,
                periodEnd,
              })
            }
            className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {t("approvals.sendButton")}
          </button>
        </div>
      </div>

      {/* Sendte anmodninger */}
      <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            {t("approvals.sentTitle")}
          </h3>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : !requests || requests.length === 0 ? (
          <div className="p-6 text-sm text-gray-500 dark:text-gray-400">
            {t("approvals.empty")}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {requests.map((r) => {
              const meta = STATUS_META[r.status] ?? STATUS_META.pending;
              const StatusIcon = meta.icon;
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-4 px-6 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {t(
                          `approvals.status.${r.status in STATUS_META ? r.status : "pending"}`,
                        )}
                      </span>
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {r.type === "invoice_draft"
                          ? t("approvals.invoiceDraft")
                          : t("approvals.period", {
                              start: r.periodStart ?? "",
                              end: r.periodEnd ?? "",
                            })}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {t("approvals.meta", {
                        count: r.entryCount,
                        date: new Date(r.createdAt).toLocaleDateString(
                          toIntlLocale(locale),
                        ),
                      })}
                      {r.responseNote ? ` · "${r.responseNote}"` : ""}
                    </p>
                  </div>
                  {r.status === "pending" &&
                    (() => {
                      const isCancelling =
                        cancelMutation.isPending &&
                        cancelMutation.variables?.requestId === r.id;
                      return (
                        <button
                          type="button"
                          disabled={isCancelling}
                          onClick={() =>
                            cancelMutation.mutate({ requestId: r.id })
                          }
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          {isCancelling ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                          {t("approvals.cancel")}
                        </button>
                      );
                    })()}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
