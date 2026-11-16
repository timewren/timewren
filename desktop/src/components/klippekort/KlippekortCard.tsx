import {
  CalendarClock,
  Clock,
  CreditCard,
  FileDown,
  FileText,
  Receipt,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatCurrency, formatDate, formatHours } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { Klippekort } from "@/lib/types";
import { toast } from "@/stores/toastStore";

interface KlippekortCardProps {
  klippekort: Klippekort;
  onClick: (klippekort: Klippekort) => void;
  onGenerateInvoice?: (klippekort: Klippekort) => void;
}

function getProgressColor(pct: number): string {
  if (pct > 95) return "bg-red-500";
  if (pct > 80) return "bg-yellow-500";
  return "bg-emerald-500";
}

function getStatusBadge(
  status: string,
  t: (key: string) => string,
): { label: string; className: string } {
  switch (status) {
    case "active":
      return {
        label: t("klippekort.active"),
        className:
          "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30",
      };
    case "expired":
      return {
        label: t("klippekort.expired"),
        className: "bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/30",
      };
    case "depleted":
      return {
        label: t("klippekort.depleted"),
        className: "bg-red-500/15 text-red-400 ring-1 ring-red-500/30",
      };
    default:
      return {
        label: status,
        className:
          "bg-(--color-border)/50 text-(--color-text-muted) ring-1 ring-(--color-border)",
      };
  }
}

export function KlippekortCard({
  klippekort,
  onClick,
  onGenerateInvoice,
}: KlippekortCardProps) {
  const { t } = useTranslation();
  const pct =
    klippekort.total_hours > 0
      ? (klippekort.used_hours / klippekort.total_hours) * 100
      : 0;
  const remaining = Math.max(0, klippekort.total_hours - klippekort.used_hours);
  const statusBadge = getStatusBadge(klippekort.status, t);

  function openHtmlWindow(html: string) {
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  }

  async function handleExport(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const html = await tauriInvoke<string>("export_klippekort_html", {
        klippekortId: klippekort.id,
      });
      openHtmlWindow(html);
    } catch (err) {
      console.error("Failed to export klippekort:", err);
      toast.error(t("klippekort.exportFailed"));
    }
  }

  async function handleUsageReport(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const html = await tauriInvoke<string>("export_klippekort_usage", {
        klippekortId: klippekort.id,
      });
      openHtmlWindow(html);
    } catch (err) {
      console.error("Failed to export klippekort usage:", err);
      toast.error(t("klippekort.usageReportFailed"));
    }
  }

  return (
    // Card is an interactive container; the action icons inside are real
    // <button>s, so the card itself uses role="button" rather than a nested
    // <button> (which would be invalid HTML).
    // biome-ignore lint/a11y/useSemanticElements: role="button" is required — a nested <button> is invalid HTML
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(klippekort)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(klippekort);
        }
      }}
      className="w-full text-left rounded-xl border border-(--color-border) bg-(--color-surface) p-4 transition-all hover:border-(--color-accent)/40 hover:shadow-lg hover:shadow-(--color-accent)/5 cursor-pointer group"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-(--color-text) truncate">
            {klippekort.name}
          </h3>
          <p className="text-xs text-(--color-text-muted) truncate mt-0.5">
            {klippekort.client_name || t("klippekort.unknownClient")}
            {klippekort.project_name ? ` — ${klippekort.project_name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onGenerateInvoice && (
            <button
              type="button"
              title={t("klippekort.generateInvoice")}
              onClick={(e) => {
                e.stopPropagation();
                onGenerateInvoice(klippekort);
              }}
              className="inline-flex items-center justify-center h-6 w-6 rounded-md text-(--color-text-muted) hover:text-(--color-accent) hover:bg-(--color-accent)/10 transition-colors opacity-0 group-hover:opacity-100"
            >
              <FileText size={13} />
            </button>
          )}
          <button
            type="button"
            title={t("klippekort.usageReport")}
            onClick={handleUsageReport}
            className="inline-flex items-center justify-center h-6 w-6 rounded-md text-(--color-text-muted) hover:text-(--color-text) hover:bg-(--color-border)/50 transition-colors opacity-0 group-hover:opacity-100"
          >
            <Receipt size={13} />
          </button>
          <button
            type="button"
            title={t("klippekort.exportStatus")}
            onClick={handleExport}
            className="inline-flex items-center justify-center h-6 w-6 rounded-md text-(--color-text-muted) hover:text-(--color-text) hover:bg-(--color-border)/50 transition-colors opacity-0 group-hover:opacity-100"
          >
            <FileDown size={13} />
          </button>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge.className}`}
          >
            {statusBadge.label}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-xs text-(--color-text-muted)">
            {t("common.usage")}
          </span>
          <span className="text-xs font-mono text-(--color-text-muted)">
            {formatHours(klippekort.used_hours)} /{" "}
            {formatHours(klippekort.total_hours)} {t("common.hours")}
          </span>
        </div>
        <div className="h-2 rounded-full bg-(--color-border)/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${getProgressColor(pct)}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3">
        {/* Remaining hours */}
        <div className="flex items-center gap-1.5">
          <Clock size={12} className="text-(--color-text-muted)" />
          <span className="text-xs font-semibold text-(--color-text) font-mono">
            {formatHours(remaining)} {t("common.hours")}
          </span>
          <span className="text-[10px] text-(--color-text-muted)">
            {t("common.remaining")}
          </span>
        </div>

        {/* Rate */}
        <div className="flex items-center gap-1.5">
          <CreditCard size={12} className="text-(--color-text-muted)" />
          <span className="text-xs text-(--color-text-muted) font-mono">
            {formatCurrency(klippekort.hourly_rate, 2)}/t
          </span>
        </div>

        {/* Expiry */}
        {klippekort.expires_at && (
          <div className="flex items-center gap-1.5 ml-auto">
            <CalendarClock size={12} className="text-(--color-text-muted)" />
            <span className="text-[10px] text-(--color-text-muted)">
              {formatDate(klippekort.expires_at)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
