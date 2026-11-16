import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Database,
  Download,
  HardDrive,
  Loader2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { tauriInvoke } from "@/lib/tauri";
import { toast } from "@/stores/toastStore";

interface DatabaseInfo {
  file_size_bytes: number;
  client_count: number;
  project_count: number;
  time_entry_count: number;
  activity_count: number;
  klippekort_count: number;
  invoice_count: number;
  db_path: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Foreslået filnavn i dialogen, fx `timetrack_backup_20260929_1430.db`.
 *
 * Tidsstemplet er lokalt, ikke UTC — `toISOString()` ville skubbe datoen
 * en dag bagud for alt efter kl. 02.00 dansk tid. Samme regel som
 * `toLocalDateStr()` i `lib/format.ts`.
 */
function standardFilnavn(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stempel = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
  return `timetrack_backup_${stempel}.db`;
}

export function BackupSettings() {
  const { t } = useTranslation();
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [importPath, setImportPath] = useState<string | null>(null);

  const loadDatabaseInfo = useCallback(async () => {
    try {
      const info = await tauriInvoke<DatabaseInfo>("get_database_info");
      setDbInfo(info);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadDatabaseInfo();
  }, [loadDatabaseInfo]);

  async function handleExport() {
    // Destinationen spørges om FØR der skrives noget. Den gamle rækkefølge
    // lavede backupen i en temp-mappe og viste så en dialog, men kopierede
    // aldrig filen hen til det valgte sted — brugeren fik en tempsti, som
    // macOS rydder, og troede backupen lå i den mappe, de havde valgt.
    //
    // `exporting` sættes FØR dialogen, så knappen er låst fra det første
    // klik. To eksporter til samme sti er ikke harmløs: `konsistent_kopi`
    // sletter den eksisterende fil før den skriver, så to samtidige kald
    // kan slette hinandens resultat og efterlade brugeren uden backup.
    setExporting(true);
    try {
      const savePath = await save({
        defaultPath: standardFilnavn(),
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      });

      // Brugeren fortrød dialogen — intet er skrevet, og det skal også
      // være det. Ingen toast: brugeren bad om intet og fik intet.
      if (!savePath) return;

      // Den sti der skrives er præcis den, brugeren valgte.
      const written = await tauriInvoke<string>("export_database", {
        path: savePath,
      });
      toast.success(t("backup.exportedTo", { path: written }));
    } catch (err) {
      // Samme nøgle som importen bruger, så "filvælgeren kunne ikke åbnes"
      // altid læses det samme — uanset hvilken knap der trykkes.
      toast.error(t("backup.couldNotOpenDialog", { error: String(err) }));
    } finally {
      setExporting(false);
    }
  }

  async function handleImportSelect() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "SQLite Database", extensions: ["db"] }],
      });

      if (typeof selected === "string") {
        setImportPath(selected);
        setShowImportConfirm(true);
      }
    } catch (err) {
      // Dialogen kunne ikke åbnes. Vis kun det, der er brug for.
      toast.error(t("backup.couldNotOpenDialog", { error: String(err) }));
    }
  }

  async function handleImportConfirm() {
    if (!importPath) return;
    setImporting(true);
    setShowImportConfirm(false);

    try {
      await tauriInvoke("import_database", { path: importPath });
      toast.success(t("backup.importSuccess"));
      // Reload database info
      await loadDatabaseInfo();
    } catch (err) {
      toast.error(t("backup.importFailed", { error: String(err) }));
    } finally {
      setImporting(false);
      setImportPath(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Database info */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            <span className="inline-flex items-center gap-2">
              <Database size={16} />
              {t("backup.database")}
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("backup.databaseDescription")}
          </p>
        </div>

        {dbInfo && (
          <div className="rounded-lg border border-(--color-border) bg-(--color-bg) p-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2 text-(--color-text-muted)">
                <HardDrive size={12} />
                <span>{t("backup.size")}</span>
              </div>
              <span className="text-right font-medium text-(--color-text)">
                {formatFileSize(dbInfo.file_size_bytes)}
              </span>

              <span className="text-(--color-text-muted)">
                {t("backup.clients")}
              </span>
              <span className="text-right font-medium text-(--color-text)">
                {dbInfo.client_count}
              </span>

              <span className="text-(--color-text-muted)">
                {t("backup.projects")}
              </span>
              <span className="text-right font-medium text-(--color-text)">
                {dbInfo.project_count}
              </span>

              <span className="text-(--color-text-muted)">
                {t("backup.timeEntries")}
              </span>
              <span className="text-right font-medium text-(--color-text)">
                {dbInfo.time_entry_count}
              </span>

              <span className="text-(--color-text-muted)">
                {t("backup.activities")}
              </span>
              <span className="text-right font-medium text-(--color-text)">
                {dbInfo.activity_count}
              </span>

              <span className="text-(--color-text-muted)">
                {t("backup.klippekort")}
              </span>
              <span className="text-right font-medium text-(--color-text)">
                {dbInfo.klippekort_count}
              </span>

              <span className="text-(--color-text-muted)">
                {t("backup.invoices")}
              </span>
              <span className="text-right font-medium text-(--color-text)">
                {dbInfo.invoice_count}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* Export */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("backup.exportTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("backup.exportDescription")}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Download size={14} />
          )}
          {t("backup.exportButton")}
        </Button>
      </section>

      {/* Import */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("backup.importTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("backup.importDescription")}
          </p>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle
              size={14}
              className="mt-0.5 shrink-0 text-amber-400"
            />
            <p className="text-xs text-amber-300">
              {t("backup.importWarning")}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleImportSelect}
          disabled={importing}
        >
          {importing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Upload size={14} />
          )}
          {t("backup.importButton")}
        </Button>
      </section>

      {/* Import confirmation dialog */}
      <Dialog
        open={showImportConfirm}
        onClose={() => setShowImportConfirm(false)}
        title={t("backup.importConfirmTitle")}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowImportConfirm(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={handleImportConfirm}>
              {t("backup.importReplace")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-(--color-text)">
            {t("backup.importConfirmText")}
          </p>
          <p className="text-xs text-(--color-text-muted)">
            {t("backup.importConfirmDescription")}
          </p>
          {importPath && (
            <p className="rounded-md bg-(--color-bg) px-3 py-2 text-xs font-mono text-(--color-text-muted) break-all">
              {importPath}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
