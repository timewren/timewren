import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function SplashScreen({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unlisten = listen("app-ready", () => {
      setReady(true);
    });

    // Fallback: if the event was already emitted before we registered,
    // dismiss after a reasonable timeout
    const timeout = setTimeout(() => {
      setReady(true);
    }, 5000);

    return () => {
      unlisten.then((fn) => fn());
      clearTimeout(timeout);
    };
  }, []);

  return (
    <>
      <AnimatePresence>
        {!ready && (
          <motion.div
            key="splash"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-(--color-bg)"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="flex flex-col items-center gap-6"
            >
              {/* Logo / Brand */}
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-(--color-accent)">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <span className="text-2xl font-bold tracking-tight text-(--color-text)">
                  TimeTrack
                </span>
              </div>

              {/* Spinner + text */}
              <div className="flex items-center gap-2.5 text-sm text-(--color-text-muted)">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-(--color-accent) border-t-transparent" />
                <span>{t("common.loadingEllipsis")}</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Render children immediately so React Router can set up,
          but they'll be hidden behind the splash overlay */}
      {children}
    </>
  );
}
