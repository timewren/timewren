"use client";

import { Clock, Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatTime } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

interface AssignEntriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  packageId: string;
  packageName: string;
  remainingHours: number;
  /** Kaldes efter et vellykket træk, så saldo og historik hentes igen */
  onAssigned: () => void;
}

/**
 * Bulk-tilknytning af eksisterende tid til et klippekort (kunde A): tid der
 * blev registreret som normal tid kan trækkes på kortet bagefter, uden at
 * slette og oprette posterne igen.
 */
export function AssignEntriesModal({
  isOpen,
  onClose,
  packageId,
  packageName,
  remainingHours,
  onAssigned,
}: AssignEntriesModalProps) {
  const t = useTranslations("klippekort");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const {
    data: entries,
    isLoading,
    isError,
  } = trpc.prepaid.getAssignableEntries.useQuery(
    { packageId },
    { enabled: isOpen },
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
      // invoice-politik: poster kortet ikke kunne dække er stadig fakturerbare
      if (result.overflowed > 0) {
        toast.warning(t("overflowed", { count: result.overflowed }));
      }
      setSelected(new Set());
      utils.prepaid.invalidate();
      utils.time.invalidate();
      onAssigned();
      onClose();
    },
    onError: (error) => {
      toast.error(error.message || t("assign.failed"));
    },
  });

  const selectedHours = useMemo(
    () =>
      (entries ?? [])
        .filter((e) => selected.has(e.id))
        .reduce((sum, e) => sum + e.hours, 0),
    [entries, selected],
  );
  const exceedsBalance = selectedHours > remainingHours;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === (entries?.length ?? 0)
        ? new Set()
        : new Set((entries ?? []).map((e) => e.id)),
    );
  };

  const handleClose = () => {
    setSelected(new Set());
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("assign.title")}
      description={t("assign.description", { name: packageName })}
      size="full"
    >
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-brand-600 dark:text-brand-400" />
        </div>
      ) : isError ? (
        <p className="rounded-lg bg-red-50 px-3 py-3 text-center text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {t("assign.loadFailed")}
        </p>
      ) : !entries || entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-10 text-center">
          <Clock className="mx-auto h-10 w-10 text-gray-400" />
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            {t("assign.empty")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={toggleAll}
              className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {selected.size === entries.length
                ? t("assign.deselectAll")
                : t("assign.selectAll", { count: entries.length })}
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("assign.balance", { time: formatTime(remainingHours) })}
            </span>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <input
                      type="checkbox"
                      checked={selected.has(entry.id)}
                      onChange={() => toggle(entry.id)}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                    />
                    <span className="w-20 shrink-0 text-xs text-gray-500 dark:text-gray-400">
                      {new Date(entry.date).toLocaleDateString(
                        toIntlLocale(locale),
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-white">
                      {entry.description}
                      {entry.projectName && (
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                          {entry.projectName}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-sm font-medium text-gray-900 dark:text-white">
                      {formatTime(entry.hours)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          {exceedsBalance && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              {t("assign.exceeds", {
                selected: formatTime(selectedHours),
                balance: formatTime(remainingHours),
              })}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-3 dark:border-gray-800">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {t("assign.selectedSummary", {
                count: selected.size,
                time: formatTime(selectedHours),
              })}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {tc("cancel")}
              </button>
              <button
                type="button"
                disabled={selected.size === 0 || assignMutation.isPending}
                onClick={() =>
                  assignMutation.mutate({
                    packageId,
                    timeEntryIds: Array.from(selected),
                  })
                }
                className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
              >
                {assignMutation.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t("assign.submit")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
