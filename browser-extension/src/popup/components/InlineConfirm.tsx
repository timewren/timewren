import { useModalDialog } from "../../hooks/useModalDialog";
import { useT } from "../../i18n";

interface InlineConfirmProps {
  message: string;
  details?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}

/**
 * Bekræftelse inde i siden. window.confirm vises ikke i Firefox' popup, så
 * handlinger der skal bekræftes, spørger her i stedet. Fokus flyttes ind
 * (først på Annuller), Esc annullerer, og fokus går tilbage bagefter. Den
 * er ikke modal: Tab kan forlade boksen.
 */
export function InlineConfirm({
  message,
  details = [],
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  className = "",
}: InlineConfirmProps) {
  const { t } = useT();
  const ref = useModalDialog(onCancel, true, { modal: false });
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className={`px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg outline-none ${className}`}
      role="alertdialog"
      aria-label={message}
    >
      <p className="text-sm font-medium text-amber-800">{message}</p>
      {details.map((detail) => (
        <p key={detail} className="text-xs text-amber-800 mt-0.5">
          {detail}
        </p>
      ))}
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-3 py-1.5 text-xs font-medium bg-[var(--color-surface-elevated)] border border-[var(--color-border-strong)] rounded-lg hover:bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]"
        >
          {cancelLabel ?? t("popup.confirm.cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 px-3 py-1.5 text-xs font-medium bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200 text-amber-800"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
