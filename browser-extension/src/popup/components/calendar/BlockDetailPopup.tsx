import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Pencil, Play, Trash2, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { apiClient } from "../../../api/client";
import { useModalDialog } from "../../../hooks/useModalDialog";
import { useT } from "../../../i18n";
import { userErrorMessage } from "../../../lib/api-error";
import { formatHoursShort } from "../../../lib/format-hours";
import { invalidateEntryQueries } from "../../../lib/query-invalidation";
import { useTimerStore } from "../../../stores/timerStore";

interface BlockDetailPopupProps {
  entry: {
    id: string;
    description: string;
    hours: number;
    startTime: string | null;
    endTime: string | null;
    projectName: string | null;
    clientName: string | null;
    clientId: string | null;
    projectId: string | null;
    /** Posten er trukket fra et klippekort (kun kendt fra kalenderens liste) */
    isFromPrepaid?: boolean;
  };
  onClose: () => void;
  onEdit?: () => void;
}

function formatTimeStr(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function BlockDetailPopup({
  entry,
  onClose,
  onEdit,
}: BlockDetailPopupProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const startTimer = useTimerStore((s) => s.startTimer);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dialogRef = useModalDialog(onClose);
  // Bekræftelsen ligger inde i dialogen: Esc og fokus ind, dialogens egen
  // fokusfælde gælder stadig
  const confirmRef = useModalDialog(
    () => setConfirmDelete(false),
    confirmDelete,
    { modal: false },
  );

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.deleteTimeEntry(entry.id),
    onSuccess: () => {
      // Serveren giver klippekortet timerne tilbage — saldoen skal med
      invalidateEntryQueries(queryClient);
      onClose();
    },
  });

  const handleStartTimer = () => {
    startTimer(entry.projectId, entry.clientId, entry.description || "");
    onClose();
  };

  const timeRange =
    entry.startTime && entry.endTime
      ? `${formatTimeStr(entry.startTime)}–${formatTimeStr(entry.endTime)}`
      : t("entry.block.untimed");

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: klik på baggrunden lukker; tastaturet bruger Esc (useModalDialog)
    <div
      className="fixed inset-0 bg-[var(--color-surface-overlay)] z-50 flex items-end justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("entry.block.detailsLabel")}
        className="w-full bg-[var(--color-surface-elevated)] rounded-t-[14px] animate-slide-up outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {t("entry.block.details")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-lg"
            aria-label={t("entry.block.close")}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 py-3 space-y-2">
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              {entry.clientName || t("entry.block.internal")}
            </p>
            {entry.projectName && (
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {entry.projectName}
              </p>
            )}
          </div>

          {entry.description && (
            <p className="text-xs text-[var(--color-text-secondary)]">
              {entry.description}
            </p>
          )}

          <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
            <Clock size={12} aria-hidden="true" />
            <span>{timeRange}</span>
            <span className="font-medium">{formatHoursShort(entry.hours)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-[var(--color-border-default)] flex gap-2">
          <button
            type="button"
            onClick={handleStartTimer}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-primary-600 text-[var(--color-on-primary)] text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Play size={14} aria-hidden="true" />
            {t("entry.block.start")}
          </button>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-[var(--color-surface-base)] border border-[var(--color-border-strong)] text-[var(--color-text-primary)] text-sm font-medium rounded-lg hover:bg-[var(--color-surface-sunken)] transition-colors"
            >
              <Pencil size={14} aria-hidden="true" />
              {t("entry.block.edit")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={deleteMutation.isPending || confirmDelete}
            className="flex items-center justify-center gap-1.5 py-2 px-4 bg-red-50 text-red-700 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            <Trash2 size={14} aria-hidden="true" />
            {deleteMutation.isPending ? "…" : t("entry.block.delete")}
          </button>
        </div>

        {confirmDelete && (
          <div
            ref={confirmRef}
            tabIndex={-1}
            className="mx-4 mb-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg outline-none"
            role="alertdialog"
            aria-label={t("entry.block.confirmDelete")}
          >
            <p className="text-sm text-red-800">
              {entry.clientName
                ? t("entry.block.deleteQuestionClient", {
                    duration: formatHoursShort(entry.hours),
                    client: entry.clientName,
                  })
                : t("entry.block.deleteQuestionInternal", {
                    duration: formatHoursShort(entry.hours),
                  })}
            </p>
            {entry.isFromPrepaid && (
              <p className="text-xs text-red-700 mt-0.5">
                {t("entry.block.prepaidRefund")}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleteMutation.isPending}
                className="flex-1 px-3 py-1.5 text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border-strong)] rounded-lg hover:bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)] disabled:opacity-50"
              >
                {t("entry.block.keep")}
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 px-3 py-1.5 text-xs font-medium bg-red-100 border border-red-300 rounded-lg hover:bg-red-200 text-red-800 disabled:opacity-50"
              >
                {deleteMutation.isPending
                  ? t("entry.block.deleting")
                  : t("entry.block.delete")}
              </button>
            </div>
          </div>
        )}

        {deleteMutation.error && (
          <p
            className="px-4 pb-3 text-xs text-red-700 text-center"
            role="alert"
          >
            {userErrorMessage(
              deleteMutation.error,
              t("entry.block.deleteFailed"),
            )}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
