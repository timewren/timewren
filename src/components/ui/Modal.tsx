"use client";

import { X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useUiText } from "./use-ui-text";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  description?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  full: "max-w-4xl",
};

export function Modal({
  isOpen,
  onClose,
  children,
  title,
  description,
  size = "md",
  closeOnOverlayClick = true,
  closeOnEscape = true,
  showCloseButton = true,
}: ModalProps) {
  const t = useUiText();
  const instanceId = useId();
  const titleId = `modal-title-${instanceId}`;
  const descId = `modal-desc-${instanceId}`;
  const dialogRef = useRef<HTMLDivElement>(null);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && closeOnEscape) {
        onClose();
      }
    },
    [onClose, closeOnEscape],
  );

  useEffect(() => {
    if (!isOpen) return;

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    const el = dialogRef.current;
    if (el) {
      const prev = document.activeElement as HTMLElement | null;
      const first = el.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();

      const handleTab = (e: KeyboardEvent) => {
        if (e.key !== "Tab") return;
        const focusable = el.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const firstEl = focusable[0];
        const lastEl = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      };

      el.addEventListener("keydown", handleTab);
      return () => {
        document.removeEventListener("keydown", handleEscape);
        document.body.style.overflow = "unset";
        el.removeEventListener("keydown", handleTab);
        prev?.focus();
      };
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  const modalContent = (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descId : undefined}
    >
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={closeOnOverlayClick ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        className={`
          relative w-full ${sizeClasses[size]}
          bg-white dark:bg-gray-900
          border border-gray-200/80 dark:border-gray-800
          rounded-xl shadow-xl
          transform transition-all
          max-h-[90vh] overflow-hidden
          flex flex-col
        `}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-start justify-between p-4 sm:p-5 border-b border-gray-200 dark:border-gray-800">
            <div>
              {title && (
                <h2
                  id={titleId}
                  className="text-sm font-semibold text-gray-900 dark:text-white"
                >
                  {title}
                </h2>
              )}
              {description && (
                <div
                  id={descId}
                  className="mt-1 text-sm text-gray-500 dark:text-gray-400"
                >
                  {description}
                </div>
              )}
            </div>
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-gray-400 hover:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label={t("modal.close")}
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );

  // Use portal to render modal at document body
  if (typeof window !== "undefined") {
    return createPortal(modalContent, document.body);
  }

  return null;
}

// Modal with footer for actions
interface ModalWithFooterProps extends ModalProps {
  footer: ReactNode;
}

export function ModalWithFooter({
  footer,
  children,
  ...props
}: ModalWithFooterProps) {
  return (
    <Modal {...props}>
      <div className="flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto">{children}</div>
        <div className="flex items-center justify-end gap-3 pt-4 mt-4 border-t border-gray-200 dark:border-gray-800">
          {footer}
        </div>
      </div>
    </Modal>
  );
}

// Confirmation dialog
interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  isLoading?: boolean;
  confirmDisabled?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = "default",
  isLoading = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const t = useUiText();
  const confirmButtonClasses = {
    default: "bg-tt-gran hover:bg-tt-gran-moerk text-tt-paa-gran",
    warning: "bg-amber-500 hover:bg-amber-600 text-white",
    danger: "bg-red-600 hover:bg-red-700 text-white",
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      showCloseButton={false}
    >
      <div className="flex items-center justify-end gap-3 mt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {cancelLabel ?? t("modal.cancel")}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isLoading || confirmDisabled}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${confirmButtonClasses[variant]}`}
        >
          {isLoading ? t("modal.wait") : (confirmLabel ?? t("modal.confirm"))}
        </button>
      </div>
    </Modal>
  );
}

// Alert dialog (informational)
interface AlertDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  closeLabel?: string;
}

export function AlertDialog({
  isOpen,
  onClose,
  title,
  description,
  closeLabel,
}: AlertDialogProps) {
  const t = useUiText();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      showCloseButton={false}
    >
      <div className="flex justify-end mt-4">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-tt-paa-gran bg-tt-gran rounded-lg hover:bg-tt-gran-moerk transition-colors"
        >
          {closeLabel ?? t("modal.ok")}
        </button>
      </div>
    </Modal>
  );
}
