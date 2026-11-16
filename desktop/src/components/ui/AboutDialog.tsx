import { getVersion } from "@tauri-apps/api/app";
import { Clock, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "./Dialog";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenLicenses: () => void;
}

export function AboutDialog({
  open,
  onClose,
  onOpenLicenses,
}: AboutDialogProps) {
  const { t } = useTranslation();
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (open) {
      getVersion()
        .then(setVersion)
        .catch(() => setVersion("0.1.0"));
    }
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title={t("about.title")}>
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        {/* Logo */}
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-(--color-accent)/10">
          <Clock size={32} className="text-(--color-accent)" />
        </div>

        {/* App name */}
        <div>
          <h3 className="text-lg font-bold text-(--color-text)">
            TimeTrack Desktop
          </h3>
          <p className="mt-1 text-sm text-(--color-text-muted)">
            {t("about.version")} {version}
          </p>
        </div>

        {/* Built by */}
        <p className="text-sm text-(--color-text-muted)">
          {t("about.builtBy")}
        </p>

        {/* Links */}
        <div className="flex flex-col items-center gap-2">
          <a
            href="https://timetrack.dk"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-(--color-accent) hover:underline"
          >
            timetrack.dk
            <ExternalLink size={12} />
          </a>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenLicenses();
            }}
            className="text-sm text-(--color-accent) hover:underline"
          >
            {t("about.licensesLink")}
          </button>
        </div>

        {/* Copyright */}
        <p className="mt-2 text-xs text-(--color-text-muted)">
          &copy; 2026 Mahope. {t("about.rights")}.
        </p>
      </div>
    </Dialog>
  );
}
