"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";

function formatDate(dateStr: string, intlLocale: string): string {
  const d = new Date(`${dateStr}T00:00:00`); // Avoid timezone shift
  return d.toLocaleDateString(intlLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const STATUS_CONFIG: Record<string, { className: string }> = {
  pending: {
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  },
  approved: {
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  rejected: {
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  cancelled: {
    className: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  },
};

interface AbsenceRequest {
  id: string;
  status: string;
  startDate: string;
  /** null = åben periode (sygdom uden kendt slutdato, #460) */
  endDate: string | null;
  totalDays?: string | null;
  hoursPerDay?: string | null;
  note?: string | null;
  absenceType: { id: string; name: string; color: string | null };
  user?: { name: string } | null;
  registrar?: { name: string } | null;
}

interface AbsenceRequestListProps {
  requests: AbsenceRequest[];
  showUser?: boolean;
  onCancel?: (id: string) => void;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  onEdit?: (id: string) => void;
  /** Raskmelding af en åben periode: sidste fraværsdag */
  onReportWell?: (id: string, lastSickDate: string) => void;
  cancelPending?: boolean;
  approvePending?: boolean;
  rejectPending?: boolean;
  reportWellPending?: boolean;
  /** Batch-valg (#464): afventende anmodninger får en checkbox */
  selected?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

function isOpenPeriod(r: AbsenceRequest): boolean {
  return (
    r.endDate === null && (r.status === "approved" || r.status === "pending")
  );
}

/** Periodetekst: "27. aug. 2026 — 29. aug. 2026" eller "siden 27. aug. 2026" (åben) */
function formatPeriod(
  r: AbsenceRequest,
  showUser: boolean,
  intlLocale: string,
  t: (key: string, values?: Record<string, string>) => string,
): string {
  if (r.endDate) {
    return `${formatDate(r.startDate, intlLocale)}–${formatDate(r.endDate, intlLocale)}`;
  }
  return showUser
    ? t("openPeriod", { date: formatDate(r.startDate, intlLocale) })
    : t("sickSince", { date: formatDate(r.startDate, intlLocale) });
}

function ReportWellControl({
  requestId,
  startDate,
  onReportWell,
  pending,
}: {
  requestId: string;
  startDate: string;
  onReportWell: (id: string, lastSickDate: string) => void;
  pending?: boolean;
}) {
  const t = useTranslations("enterpriseComponents.absenceList");
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)} disabled={pending}>
        {t("reportWell")}
      </Button>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (date) onReportWell(requestId, date);
      }}
    >
      <label className="sr-only" htmlFor={`well-${requestId}`}>
        {t("lastAbsenceDay")}
      </label>
      <input
        id={`well-${requestId}`}
        type="date"
        value={date}
        min={startDate}
        onChange={(e) => setDate(e.target.value)}
        title={t("lastAbsenceDay")}
        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-white"
      />
      <Button size="sm" type="submit" disabled={pending || !date}>
        {t("reportWellSubmit")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        type="button"
        onClick={() => setOpen(false)}
      >
        {t("undo")}
      </Button>
    </form>
  );
}

export function AbsenceRequestList({
  requests,
  showUser = false,
  onCancel,
  onApprove,
  onReject,
  onEdit,
  onReportWell,
  cancelPending,
  approvePending,
  rejectPending,
  reportWellPending,
  selected,
  onToggleSelect,
}: AbsenceRequestListProps) {
  const t = useTranslations("enterpriseComponents.absenceList");
  const intlLocale = toIntlLocale(useLocale());
  if (requests.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-gray-500 dark:border-gray-800 dark:text-gray-400">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {requests.map((r) => {
        const status = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.cancelled;
        const open = isOpenPeriod(r);
        const period = formatPeriod(r, showUser, intlLocale, t);
        const extra = [
          r.totalDays != null && !open
            ? t("totalDays", { days: r.totalDays })
            : null,
          r.hoursPerDay
            ? t("hoursPerDay", {
                hours: Number(r.hoursPerDay).toLocaleString(intlLocale),
              })
            : null,
        ]
          .filter(Boolean)
          .join(", ");
        return (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
          >
            <div className="flex items-center gap-4">
              {onToggleSelect && r.status === "pending" && (
                <input
                  type="checkbox"
                  aria-label={t("select", {
                    name: r.user?.name ?? r.absenceType.name,
                  })}
                  checked={selected?.has(r.id) ?? false}
                  onChange={() => onToggleSelect(r.id)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:border-gray-600"
                />
              )}
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: r.absenceType.color ?? "#6b7280" }}
              />
              <div>
                {showUser && r.user ? (
                  <>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">
                      {r.user.name}
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {r.absenceType.name}
                      <span className="mx-1.5 text-gray-400">&middot;</span>
                      {period}
                      {extra && (
                        <span className="ml-1 text-gray-500">({extra})</span>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {r.absenceType.name}
                    <span className="ml-2 font-normal text-sm text-gray-500 dark:text-gray-400">
                      {period}
                      {extra && <span className="ml-1">({extra})</span>}
                    </span>
                  </p>
                )}
                {r.registrar && (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {t("registeredBy", { name: r.registrar.name })}
                  </p>
                )}
                {r.note && (
                  <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500 italic">
                    {r.note}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  open
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : status.className
                }`}
              >
                {open
                  ? t("open")
                  : t(r.status in STATUS_CONFIG ? r.status : "cancelled")}
              </span>

              {onReportWell && open && (
                <ReportWellControl
                  requestId={r.id}
                  startDate={r.startDate}
                  onReportWell={onReportWell}
                  pending={reportWellPending}
                />
              )}

              {onEdit && r.status === "pending" && (
                <Button variant="ghost" size="sm" onClick={() => onEdit(r.id)}>
                  {t("edit")}
                </Button>
              )}

              {onCancel &&
                (r.status === "pending" || r.status === "approved") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onCancel(r.id)}
                    disabled={cancelPending}
                  >
                    {t("cancel")}
                  </Button>
                )}

              {onApprove && r.status === "pending" && (
                <Button
                  size="sm"
                  onClick={() => onApprove(r.id)}
                  disabled={approvePending}
                >
                  {t("approve")}
                </Button>
              )}

              {onReject && r.status === "pending" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onReject(r.id)}
                  disabled={rejectPending}
                >
                  {t("reject")}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
