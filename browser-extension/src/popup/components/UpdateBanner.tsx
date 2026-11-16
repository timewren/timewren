import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import {
  CLIENT_TOO_OLD_KEY,
  type ClientTooOldFlag,
  readClientTooOld,
} from "../../lib/update-state";

/**
 * Serveren har afvist denne version (CLIENT_TOO_OLD): tid kan ikke gemmes,
 * før udvidelsen er opdateret. Baggrunden har allerede bedt Chrome om
 * opdateringen og genstarter, når den er hentet.
 */
export function UpdateBanner() {
  const { t } = useT();
  const [flag, setFlag] = useState<ClientTooOldFlag | null>(null);

  useEffect(() => {
    void readClientTooOld().then(setFlag);
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && CLIENT_TOO_OLD_KEY in changes) {
        void readClientTooOld().then(setFlag);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  if (!flag) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 px-4 py-2 bg-red-50 text-red-800 border-b border-red-200 text-xs"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-semibold">{t("popup.update.title")}</p>
        <p>{t("popup.update.body", { version: flag.version })}</p>
      </div>
    </div>
  );
}
