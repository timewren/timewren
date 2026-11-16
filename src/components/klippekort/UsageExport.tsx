"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  type ExportUsage,
  usageCSV,
  usageExportRows,
} from "@/lib/prepaid/usage-export";
import { downloadCSV } from "@/lib/utils/csv-export";

export function UsageExport({
  packageId,
  packageName,
  usage,
  showValue = false,
}: {
  packageId: string;
  packageName: string;
  usage: ExportUsage[];
  showValue?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  async function download(format: "csv" | "pdf") {
    setBusy(true);
    try {
      const filename = `klippekort-${packageId}-forbrug`;
      if (format === "csv") {
        downloadCSV(usageCSV(usage, showValue), `${filename}.csv`);
      } else {
        const { pdf } = await import("@react-pdf/renderer");
        const { UsagePDF } = await import("./UsagePDF");
        const blob = await pdf(
          <UsagePDF
            name={packageName}
            rows={usageExportRows(usage, showValue)}
          />,
        ).toBlob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${filename}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      toast.error("Eksporten kunne ikke hentes. Prøv igen.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset
      aria-busy={busy}
      className="my-2 flex flex-wrap gap-2"
      aria-label={`Eksportér forbrug for ${packageName}`}
    >
      {(["csv", "pdf"] as const).map((format) => (
        <button
          key={format}
          type="button"
          disabled={busy || usage.length === 0}
          onClick={() => download(format)}
          className="min-h-11 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Hent {format.toUpperCase()}
        </button>
      ))}
    </fieldset>
  );
}
