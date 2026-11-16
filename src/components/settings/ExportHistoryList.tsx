"use client";

import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";

/**
 * Fælles dele til eksport-kortene under Indstillinger > Import og eksport
 * (OrgExportCard og UserExportCard): statusmærker, dato- og størrelsesformat
 * og listen over de seneste eksporter med "Hent ZIP" og "Annullér".
 */

const STATUS: Record<string, { key: string; className: string }> = {
  pending: {
    key: "statusPending",
    className:
      "border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300",
  },
  processing: {
    key: "statusProcessing",
    className:
      "border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300",
  },
  ready: {
    key: "statusReady",
    className:
      "border-brand-600 bg-brand-50 font-semibold text-brand-700 dark:border-brand-400 dark:bg-tt-gran-lys dark:text-brand-300",
  },
  downloaded: {
    key: "statusDownloaded",
    className:
      "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300",
  },
  expired: {
    key: "statusExpired",
    className:
      "border-gray-300 text-gray-500 dark:border-gray-700 dark:text-gray-400",
  },
  failed: {
    key: "statusFailed",
    className:
      "border-red-600 text-red-700 dark:border-red-400 dark:text-red-300",
  },
};

function makeDateFmt(locale: string) {
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatSize(bytes: number | null, locale = "da"): string {
  if (!bytes) return "";
  const intl = toIntlLocale(locale);
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(intl)} kB`;
  }
  return `${mb.toLocaleString(intl, { maximumFractionDigits: 1 })} MB`;
}

export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:focus-visible:outline-brand-400";

export interface ExportListItem {
  id: string;
  status: string;
  createdAt: Date | string;
  fileSizeBytes: number | null;
  downloadToken: string | null;
}

export function isExportBusy(
  exports: Pick<ExportListItem, "status">[] | undefined,
): boolean {
  return !!exports?.some(
    (r) => r.status === "pending" || r.status === "processing",
  );
}

export function ExportHistoryList({
  exports,
  onCancel,
  heading,
}: {
  exports: ExportListItem[];
  onCancel: (id: string) => void;
  heading?: string;
}) {
  const t = useTranslations("settingsData.exports");
  const locale = useLocale();
  const dateFmt = makeDateFmt(locale);
  if (exports.length === 0) return null;
  return (
    <div className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-800">
      <h3 className="text-sm font-medium text-gray-900 dark:text-white">
        {heading ?? t("defaultHeading")}
      </h3>
      <ul className="mt-3 divide-y divide-gray-200 dark:divide-gray-800">
        {exports.map((r) => {
          const status = STATUS[r.status] ?? STATUS.pending;
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm"
            >
              <span className="tabular-nums text-gray-900 dark:text-white">
                {dateFmt.format(new Date(r.createdAt))}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${status.className}`}
              >
                {t(status.key)}
              </span>
              {r.fileSizeBytes ? (
                <span className="tabular-nums text-gray-600 dark:text-gray-400">
                  {formatSize(r.fileSizeBytes, locale)}
                </span>
              ) : null}
              <span className="w-full sm:ml-auto sm:w-auto">
                {r.downloadToken ? (
                  <a
                    href={`/api/data-export/${r.downloadToken}`}
                    className={`inline-flex min-h-11 items-center font-medium text-brand-700 underline underline-offset-2 sm:min-h-0 dark:text-brand-300 ${focusRing}`}
                  >
                    {t("downloadZip")}
                  </a>
                ) : r.status === "pending" ? (
                  <button
                    type="button"
                    onClick={() => onCancel(r.id)}
                    className={`inline-flex min-h-11 items-center text-gray-700 underline underline-offset-2 sm:min-h-0 dark:text-gray-300 ${focusRing}`}
                  >
                    {t("cancel")}
                  </button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
