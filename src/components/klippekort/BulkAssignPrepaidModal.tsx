"use client";

import { Loader2, Ticket } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { formatTime } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

interface BulkAssignPrepaidModalProps {
  isOpen: boolean;
  onClose: () => void;
  timeEntryIds: string[];
  /** Kaldes efter et vellykket træk, så listen hentes igen */
  onAssigned: () => void;
}

/**
 * Bulk fra tidsoversigten: træk de markerede posteringer på et af kundens
 * klippekort. Kunden udledes på serveren (posten kan arve den fra projektet),
 * og et udvalg på tværs af flere kunder afvises inden noget trækkes.
 */
export function BulkAssignPrepaidModal({
  isOpen,
  onClose,
  timeEntryIds,
  onAssigned,
}: BulkAssignPrepaidModalProps) {
  const t = useTranslations("klippekort");
  const tc = useTranslations("common");
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(
    null,
  );

  const { data, isLoading, error } =
    trpc.prepaid.getPackagesForEntries.useQuery(
      { timeEntryIds },
      { enabled: isOpen && timeEntryIds.length > 0, retry: false },
    );

  const utils = trpc.useUtils();
  const assignMutation = trpc.prepaid.bulkAssignEntries.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.remainingHours !== null
          ? t("assignedWithBalance", {
              count: result.assigned,
              name: result.packageName,
              balance: formatTime(result.remainingHours),
            })
          : t("assigned", {
              count: result.assigned,
              name: result.packageName,
            }),
      );
      if (result.overflowed > 0) {
        toast.warning(t("overflowed", { count: result.overflowed }));
      }
      utils.prepaid.invalidate();
      utils.time.invalidate();
      onAssigned();
      handleClose();
    },
    onError: (err) => toast.error(err.message || t("bulk.failed")),
  });

  const handleClose = () => {
    setSelectedPackageId(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("bulk.title")}
      description={t("bulk.description", { count: timeEntryIds.length })}
      size="lg"
    >
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      ) : error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error.message}
        </p>
      ) : !data?.packages.length ? (
        <p className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {data?.clientName
            ? t("bulk.noPackages", { client: data.clientName })
            : t("bulk.noClient")}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            {data.packages.map((pkg) => {
              const exceeds = data.selectedHours > pkg.remainingHours;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => setSelectedPackageId(pkg.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    selectedPackageId === pkg.id
                      ? "border-brand-500 bg-brand-50 dark:bg-tt-gran-lys"
                      : "border-gray-200 hover:border-brand-300 dark:border-gray-700 dark:hover:border-brand-700"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Ticket className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {pkg.name}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-sm tabular-nums ${
                      exceeds
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-brand-600 dark:text-brand-400"
                    }`}
                  >
                    {t("bulk.left", { time: formatTime(pkg.remainingHours) })}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("bulk.selectedHours", { time: formatTime(data.selectedHours) })}
          </p>
          {selectedPackageId &&
            data.packages.some(
              (p) =>
                p.id === selectedPackageId &&
                data.selectedHours > p.remainingHours,
            ) && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                {t("bulk.exceeds")}
              </p>
            )}

          <div className="flex justify-end gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {tc("cancel")}
            </button>
            <button
              type="button"
              disabled={!selectedPackageId || assignMutation.isPending}
              onClick={() =>
                selectedPackageId &&
                assignMutation.mutate({
                  packageId: selectedPackageId,
                  timeEntryIds,
                })
              }
              className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
            >
              {assignMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t("bulk.submit")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
