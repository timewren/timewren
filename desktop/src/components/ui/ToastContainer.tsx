import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle, Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToastStore } from "@/stores/toastStore";

const ICON_MAP = {
  success: CheckCircle,
  error: AlertTriangle,
  info: Info,
} as const;

const COLOR_MAP = {
  success: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  error: "text-red-400 bg-red-500/10 border-red-500/30",
  info: "text-blue-400 bg-blue-500/10 border-blue-500/30",
} as const;

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();
  const { t } = useTranslation();

  return (
    <div className="fixed bottom-12 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = ICON_MAP[toast.type];
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 shadow-lg ${COLOR_MAP[toast.type]}`}
            >
              <Icon size={14} className="shrink-0" />
              <span className="text-xs font-medium text-(--color-text)">
                {toast.message}
              </span>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                className="ml-1 shrink-0 rounded p-0.5 text-(--color-text-muted) hover:text-(--color-text) transition-colors"
                aria-label={t("common.closeNotification")}
              >
                <X size={12} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
