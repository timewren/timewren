"use client";

import { Loader2, Ticket } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatTime } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { AssignEntriesModal } from "./AssignEntriesModal";

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

  const handleClose = () => {
    setSelectedPackageId(null);
    onClose();
  };
  const selectedPackage = data?.packages.find(
    ({ id }) => id === selectedPackageId,
  );

  if (selectedPackage) {
    return (
      <AssignEntriesModal
        key={selectedPackage.id}
        isOpen={isOpen}
        onClose={handleClose}
        onAssigned={onAssigned}
        packageId={selectedPackage.id}
        packageName={selectedPackage.name}
        remainingHours={selectedPackage.remainingHours}
        clipSizeMinutes={selectedPackage.clipSizeMinutes}
        overdraftPolicy={selectedPackage.overdraftPolicy ?? "block"}
        timeEntryIds={timeEntryIds}
      />
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("bulk.title")}
      description={t("bulk.description", { count: timeEntryIds.length })}
      size="lg"
    >
      {isLoading ? (
        <div
          role="status"
          aria-label={tc("loading")}
          className="flex justify-center py-8"
        >
          <Loader2
            aria-hidden="true"
            className="h-6 w-6 animate-spin text-tt-gran"
          />
        </div>
      ) : error ? (
        <p role="alert" className="text-sm">
          {error.message}
        </p>
      ) : !data?.packages.length ? (
        <p className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {data?.clientId
            ? t("bulk.noPackages", { client: data.clientName ?? "" })
            : t("bulk.noClient")}
        </p>
      ) : (
        <ul className="space-y-2">
          {data.packages.map((pkg) => (
            <li key={pkg.id}>
              <button
                type="button"
                onClick={() => setSelectedPackageId(pkg.id)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-tt-streg px-3 py-2 text-left text-sm hover:bg-tt-flade"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Ticket
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-tt-gran"
                  />
                  <span className="break-words [overflow-wrap:anywhere]">
                    {pkg.name}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-tt-graa">
                  {t("bulk.left", { time: formatTime(pkg.remainingHours) })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
