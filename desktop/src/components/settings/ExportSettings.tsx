import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { tauriInvoke } from "@/lib/tauri";
import { toast } from "@/stores/toastStore";

/** Standardvalget, også brugt når intet er gemt endnu. */
const STANDARD_DATOFORMAT = "DD-MM-YYYY";

/**
 * Formaterne er mønstre, ikke sprog: `DD-MM-YYYY` betyder det samme for en tysk
 * som for en dansk bruger, så de står i koden og ikke i json-filerne.
 *
 * Eksemplerne bruger et dagstal over 12, fordi `23-05-2026` ikke kan læses uden
 * at vide om der står dag-måned eller måned-dag — og det er præcis det valget
 * skal gøre tydeligt.
 */
const DATOFORMATER = [
  { value: STANDARD_DATOFORMAT, eksempel: "27-05-2026" },
  { value: "YYYY-MM-DD", eksempel: "2026-05-27" },
] as const;

export function ExportSettings() {
  const { t } = useTranslation();
  const [csvSeparator, setCsvSeparator] = useState("semicolon");
  const [dateFormat, setDateFormat] = useState(STANDARD_DATOFORMAT);
  const [exportPath, setExportPath] = useState("");
  // `isError` er ikke kosmetik: feltet males i grønt, så en ren streng viste
  // "Fejl ved gemning" som en succes. Samme mønster som IntegrationSettings.
  const [saveStatus, setSaveStatus] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const settings =
          await tauriInvoke<{ key: string; value: string }[]>(
            "get_all_settings",
          );
        const map = new Map(settings.map((s) => [s.key, s.value]));
        setCsvSeparator(map.get("csv_separator") ?? "semicolon");
        setDateFormat(map.get("date_format") ?? STANDARD_DATOFORMAT);
        setExportPath(map.get("export_path") ?? "");
      } catch {
        // use defaults
      }
    }
    loadSettings();
  }, []);

  const saveSetting = useCallback(
    async (key: string, value: string) => {
      try {
        await tauriInvoke("set_setting", { key, value });
        setSaveStatus({ text: t("common.saved"), isError: false });
        setTimeout(() => setSaveStatus(null), 2000);
      } catch {
        setSaveStatus({ text: t("common.errorSaving"), isError: true });
        setTimeout(() => setSaveStatus(null), 3000);
      }
    },
    [t],
  );

  async function handleChooseFolder() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === "string") {
        setExportPath(selected);
        saveSetting("export_path", selected);
      }
    } catch (err) {
      // Samme grund som i BackupSettings: dialogen lå i et dynamisk
      // `import()` af en pakke, der ikke var installeret, så denne kode
      // kastede altid, og mappevælgeren virkede aldrig.
      console.error("Failed to open folder picker:", err);
      toast.error(t("exportSettings.folderPickerFailed"));
    }
  }

  return (
    <div className="space-y-8">
      {saveStatus && (
        <div
          className={`fixed right-6 top-16 z-50 rounded-md bg-(--color-surface) border border-(--color-border) px-3 py-1.5 text-xs font-medium shadow-lg ${saveStatus.isError ? "text-red-400" : "text-emerald-400"}`}
        >
          {saveStatus.text}
        </div>
      )}

      {/* CSV separator */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("exportSettings.csvSeparator")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("exportSettings.csvSeparatorDescription")}
          </p>
        </div>
        <div className="flex gap-2">
          {[
            { value: "semicolon", label: t("exportSettings.semicolonLabel") },
            { value: "comma", label: t("exportSettings.commaLabel") },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setCsvSeparator(opt.value);
                saveSetting("csv_separator", opt.value);
              }}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                csvSeparator === opt.value
                  ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)"
                  : "border-(--color-border) bg-(--color-bg) text-(--color-text-muted) hover:border-(--color-text-muted)"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-(--color-text-muted)">
          {t("exportSettings.csvSeparatorHint")}
        </p>
      </section>

      {/* Date format */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("exportSettings.dateFormat")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("exportSettings.dateFormatDescription")}
          </p>
        </div>
        <div className="flex gap-2">
          {DATOFORMATER.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setDateFormat(opt.value);
                saveSetting("date_format", opt.value);
              }}
              className={`flex flex-col items-start rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                dateFormat === opt.value
                  ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)"
                  : "border-(--color-border) bg-(--color-bg) text-(--color-text-muted) hover:border-(--color-text-muted)"
              }`}
            >
              <span>{opt.value}</span>
              <span className="text-[10px] font-normal opacity-70">
                {opt.eksempel}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Export path */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("exportSettings.defaultFolder")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("exportSettings.defaultFolderDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={exportPath}
            onChange={(e) => setExportPath(e.target.value)}
            onBlur={() => {
              if (exportPath) saveSetting("export_path", exportPath);
            }}
            placeholder={t("exportSettings.chooseFolderPlaceholder")}
            aria-label={t("exportSettings.defaultFolder")}
            className="flex-1 max-w-md"
          />
          <Button variant="secondary" size="md" onClick={handleChooseFolder}>
            <FolderOpen size={14} />
            {t("common.choose")}
          </Button>
        </div>
      </section>
    </div>
  );
}
