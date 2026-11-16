import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { t } = useTranslation();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
          />

          {/* Panel */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="relative z-10 w-full max-w-md rounded-xl border border-(--color-border) bg-(--color-surface) shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-(--color-border) px-5 py-4">
              <h2
                id={titleId}
                className="text-sm font-semibold text-(--color-text)"
              >
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.closeDialog")}
                className="flex h-6 w-6 items-center justify-center rounded-md text-(--color-text-muted) transition-colors hover:bg-(--color-border) hover:text-(--color-text)"
              >
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4">{children}</div>

            {/* Footer */}
            {footer && (
              <div className="flex items-center justify-end gap-2 border-t border-(--color-border) px-5 py-3">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
