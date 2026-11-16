import { Download, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { tauriInvoke } from "@/lib/tauri";
import { useSyncStore } from "@/stores/syncStore";

interface UpdateInfo {
  version: string;
  body: string | null;
  date: string | null;
}

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const { t } = useTranslation();
  // Serveren afviser skrivninger fra denne version (HTTP 426). Lokale
  // ændringer ligger i synk-køen, til den nye version sender dem.
  const klientForGammel = useSyncStore((s) => s.klientForGammel);

  useEffect(() => {
    // Delay check by 5 seconds to not slow down startup
    const timer = setTimeout(async () => {
      try {
        const info = await tauriInvoke<UpdateInfo | null>("check_for_update");
        if (info) {
          setUpdate(info);
        }
      } catch {
        // Silently ignore update check failures
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  const [soeger, setSoeger] = useState(false);

  // Søg efter en ny version; brugt straks ved CLIENT_TOO_OLD og af knappen,
  // når updateren ikke fandt noget (eller fejlede) — prompten må ikke blindgyde.
  const soegOpdatering = useCallback(async () => {
    setSoeger(true);
    try {
      const info = await tauriInvoke<UpdateInfo | null>("check_for_update");
      if (info) setUpdate(info);
    } catch {
      // Updater-fejl logges i Rust; prompten vises stadig.
    } finally {
      setSoeger(false);
    }
  }, []);

  // For gammel version: søg straks efter opdateringen, og vis prompten igen,
  // selvom brugeren havde lukket banneret.
  useEffect(() => {
    if (!klientForGammel) return;
    setDismissed(false);
    soegOpdatering();
  }, [klientForGammel, soegOpdatering]);

  if (!klientForGammel && (!update || dismissed)) return null;

  async function handleInstall() {
    setInstalling(true);
    try {
      // Downloads, installs and relaunches into the new version. On success the
      // app restarts, so we don't reset the installing state here.
      await tauriInvoke("install_update");
    } catch {
      // Re-enable the button so the user can retry; the Rust side logs details.
      setInstalling(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-(--color-accent) px-4 py-1.5">
      <div className="flex items-center gap-2 text-sm text-white">
        <Download size={14} className="shrink-0" />
        <span>
          {klientForGammel || !update
            ? t("updates.clientTooOld")
            : t("updates.newVersionAvailable", { version: update.version })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {!update && (
          <button
            type="button"
            onClick={soegOpdatering}
            disabled={soeger}
            className="rounded-md bg-white/20 px-2.5 py-0.5 text-xs font-medium text-white transition-colors hover:bg-white/30 disabled:opacity-50"
          >
            {soeger ? t("updates.checking") : t("updates.checkButton")}
          </button>
        )}
        {update && (
          <button
            type="button"
            onClick={handleInstall}
            disabled={installing}
            className="rounded-md bg-white/20 px-2.5 py-0.5 text-xs font-medium text-white transition-colors hover:bg-white/30 disabled:opacity-50"
          >
            {installing ? t("updates.installing") : t("updates.installNow")}
          </button>
        )}
        {!klientForGammel && (
          <button
            type="button"
            aria-label={t("updates.dismiss")}
            onClick={() => setDismissed(true)}
            className="rounded p-0.5 text-white/70 transition-colors hover:text-white"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
