"use client";

import { FileArchive } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { trpc } from "@/providers/trpc-provider";
import {
  ExportHistoryList,
  focusRing,
  isExportBusy,
} from "./ExportHistoryList";

/**
 * Selvbetjent eksport af alle organisationens data som én ZIP-fil. Vises
 * under Indstillinger > Import og eksport for ejere og administratorer (og
 * solo-brugere, der altid er ejere).
 */
export function OrgExportCard() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("settingsData.org");
  const tx = useTranslations("settingsData.exports");
  const { canManage, isSolo, isResolved } = useOrgRole();
  const utils = trpc.useUtils();

  const { data: flags } = trpc.dataExport.getExportFlags.useQuery();
  const fullExportEnabled = flags?.fullExportEnabled ?? true;

  const { data: exports } = trpc.dataExport.listOrgExports.useQuery(undefined, {
    enabled: canManage && fullExportEnabled,
    refetchInterval: (query) =>
      query.state.data?.some(
        (r) => r.status === "pending" || r.status === "processing",
      )
        ? 10_000
        : false,
  });

  const request = trpc.dataExport.requestOrgExport.useMutation({
    onSuccess: () => {
      toast.success(tx("ordered"));
      utils.dataExport.listOrgExports.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const cancel = trpc.dataExport.cancelExportRequest.useMutation({
    onSuccess: () => {
      toast.success(tx("cancelled"));
      utils.dataExport.listOrgExports.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const busy = isExportBusy(exports);

  return (
    <section
      aria-labelledby="org-export-heading"
      className="rounded-xl border border-gray-200/80 bg-white p-5 sm:p-6 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-tt-gran-lys">
          <FileArchive
            aria-hidden="true"
            strokeWidth={1.5}
            className="h-5 w-5 text-brand-700 dark:text-brand-300"
          />
        </div>
        <div className="min-w-0">
          <h2
            id="org-export-heading"
            className="text-base font-semibold text-gray-900 dark:text-white"
          >
            {isSolo ? t("titleSolo") : t("titleAll")}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t("intro")}
          </p>
        </div>
      </div>

      {isResolved && !canManage ? (
        <p className="mt-5 text-sm text-gray-700 dark:text-gray-300">
          {t("adminOnly")}
        </p>
      ) : !fullExportEnabled ? (
        <p className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {t("unavailable")}
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-5 text-sm text-gray-700 sm:grid-cols-2 dark:text-gray-300">
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">
                {tx("includedHeading")}
              </h3>
              <p className="mt-1.5 leading-relaxed">{t("included")}</p>
            </div>
            <div>
              <h3 className="font-medium text-gray-900 dark:text-white">
                {t("fileHeading")}
              </h3>
              <ul className="mt-1.5 space-y-1 leading-relaxed">
                <li>
                  {t.rich("fileData", {
                    b: (chunks) => (
                      <span className="font-medium">{chunks}</span>
                    ),
                  })}
                </li>
                <li>
                  {t.rich("fileCsv", {
                    b: (chunks) => (
                      <span className="font-medium">{chunks}</span>
                    ),
                  })}
                </li>
                <li>
                  {t.rich("fileFiles", {
                    b: (chunks) => (
                      <span className="font-medium">{chunks}</span>
                    ),
                  })}
                </li>
                <li>
                  {t.rich("fileReadme", {
                    b: (chunks) => (
                      <span className="font-medium">{chunks}</span>
                    ),
                  })}
                </li>
              </ul>
            </div>
          </div>

          <p className="mt-5 text-sm text-gray-600 dark:text-gray-400">
            {t("buildNote", { brand: brand.name })}
          </p>

          <div className="mt-5">
            <button
              type="button"
              onClick={() => request.mutate()}
              disabled={request.isPending || busy}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg bg-tt-gran px-5 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10 dark:text-gray-950 ${focusRing}`}
            >
              {request.isPending
                ? tx("ordering")
                : busy
                  ? tx("inProgress")
                  : t("order")}
            </button>
          </div>

          <ExportHistoryList
            exports={exports ?? []}
            onCancel={(id) => cancel.mutate({ id })}
          />
        </>
      )}
    </section>
  );
}
