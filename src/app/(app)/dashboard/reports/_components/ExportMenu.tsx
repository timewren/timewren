// src/app/dashboard/reports/_components/ExportMenu.tsx
"use client";
import {
  ChevronDown,
  Download,
  FileJson,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isLocale } from "@/i18n/config";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";
import { trpc } from "@/providers/trpc-provider";

interface Props {
  config: ReportTemplateConfig;
  templateId: string | null;
}

const FORMATS = [
  { key: "pdf" as const, label: "PDF", icon: FileText },
  { key: "xlsx" as const, label: "Excel (.xlsx)", icon: FileSpreadsheet },
  { key: "csv" as const, label: "CSV", icon: FileSpreadsheet },
  { key: "json" as const, label: "JSON", icon: FileJson },
];

export function ExportMenu({ config, templateId }: Props) {
  const t = useTranslations("reports");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const exportMutation = trpc.reports.exportReport.useMutation();
  const bumpUsage = trpc.reportTemplates.bumpUsage.useMutation();

  const run = async (format: "csv" | "xlsx" | "json" | "pdf") => {
    setOpen(false);
    try {
      toast.loading(t("export.generating"), { id: "export" });
      const result = await exportMutation.mutateAsync({
        config,
        format,
        locale: isLocale(locale) ? locale : undefined,
      });
      const filenameBase = `tidsrapport_${Date.now()}`;

      if (result.format === "csv" || result.format === "json") {
        const blob = new Blob([result.data], {
          type:
            result.format === "csv"
              ? "text/csv;charset=utf-8"
              : "application/json",
        });
        download(blob, `${filenameBase}.${result.format}`);
      } else if (result.format === "xlsx") {
        const bin = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
        const blob = new Blob([bin], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        download(blob, `${filenameBase}.xlsx`);
      } else if (result.format === "pdf-data") {
        const [{ pdf }, { ReportPDF }] = await Promise.all([
          import("@react-pdf/renderer"),
          import("@/lib/reports/generators/pdf/ReportPDF"),
        ]);
        const doc = (
          <ReportPDF
            config={config}
            aggregates={result.aggregates}
            entries={result.entries}
            startDate={result.period.start}
            endDate={result.period.end}
            logoUrl={result.logoUrl}
            companyName={result.companyName}
          />
        );
        const blob = await pdf(doc).toBlob();
        download(blob, `${filenameBase}.pdf`);
      }

      if (templateId) {
        bumpUsage.mutate({ id: templateId });
      }
      toast.success(t("export.exported"), { id: "export" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("export.exportError"), {
        id: "export",
      });
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("export.ariaLabel")}
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
      >
        <Download className="h-4 w-4" />
        {t("export.button")}
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-2 w-52 overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900"
        >
          {FORMATS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={() => run(key)}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <Icon className="h-4 w-4 text-gray-400 dark:text-gray-500" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
