import { useTranslation } from "react-i18next";
import { Dialog } from "./Dialog";

interface LicensesDialogProps {
  open: boolean;
  onClose: () => void;
}

const FRONTEND_LICENSES = [
  { name: "React", license: "MIT" },
  { name: "React DOM", license: "MIT" },
  { name: "TanStack Router", license: "MIT" },
  { name: "Zustand", license: "MIT" },
  { name: "Framer Motion", license: "MIT" },
  { name: "i18next", license: "MIT" },
  { name: "react-i18next", license: "MIT" },
  { name: "Recharts", license: "MIT" },
  { name: "cmdk", license: "MIT" },
  { name: "Lucide React", license: "ISC" },
  { name: "Tauri API", license: "MIT/Apache-2.0" },
  { name: "date-fns", license: "MIT" },
  { name: "Sentry", license: "MIT" },
];

const BACKEND_LICENSES = [
  { name: "Tauri", license: "MIT/Apache-2.0" },
  { name: "rusqlite", license: "MIT" },
  { name: "Serde", license: "MIT/Apache-2.0" },
  { name: "reqwest", license: "MIT/Apache-2.0" },
  { name: "Tokio", license: "MIT" },
  { name: "chrono", license: "MIT/Apache-2.0" },
  { name: "uuid", license: "MIT/Apache-2.0" },
  { name: "regex", license: "MIT/Apache-2.0" },
  { name: "sha2", license: "MIT/Apache-2.0" },
  { name: "Sentry", license: "Apache-2.0" },
  { name: "windows", license: "MIT/Apache-2.0" },
];

export function LicensesDialog({ open, onClose }: LicensesDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onClose} title={t("about.licenses")}>
      <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
        <p className="text-sm text-(--color-text-muted)">
          {t("about.licensesDesc")}:
        </p>

        {/* Frontend */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">
            {t("about.frontend")}
          </h4>
          <div className="space-y-1">
            {FRONTEND_LICENSES.map((dep) => (
              <div
                key={dep.name}
                className="flex items-center justify-between rounded px-2 py-1 text-sm"
              >
                <span className="text-(--color-text)">{dep.name}</span>
                <span className="text-xs text-(--color-text-muted)">
                  {dep.license}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Backend */}
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">
            {t("about.backend")}
          </h4>
          <div className="space-y-1">
            {BACKEND_LICENSES.map((dep) => (
              <div
                key={dep.name}
                className="flex items-center justify-between rounded px-2 py-1 text-sm"
              >
                <span className="text-(--color-text)">{dep.name}</span>
                <span className="text-xs text-(--color-text-muted)">
                  {dep.license}
                </span>
              </div>
            ))}
          </div>
        </section>

        <p className="text-xs text-(--color-text-muted)">
          {t("about.fullLicenses")}
        </p>
      </div>
    </Dialog>
  );
}
