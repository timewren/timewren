import { AlertTriangle, ClipboardCopy, Clock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "@/components/ui/LoadError";
import { formatHours } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { LowKlippekort } from "@/lib/types";
import { toast } from "@/stores/toastStore";

export function LowKlippekortAlert() {
  const { t } = useTranslation();
  const [items, setItems] = useState<LowKlippekort[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // Read the configured threshold; the backend falls back to its own
      // default when we pass null, so a missing setting is safe.
      const raw = await tauriInvoke<string | null>("get_setting", {
        key: "klippekort_low_threshold_hours",
      });
      const parsed = raw
        ? Number.parseFloat(raw.replace(",", "."))
        : Number.NaN;
      const threshold = Number.isFinite(parsed) ? parsed : null;
      const result = await tauriInvoke<LowKlippekort[]>("get_low_klippekort", {
        thresholdHours: threshold,
      });
      setItems(result);
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to load low klippekort:", err);
      setLoadFailed(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const copyMailDraft = useCallback(
    async (kk: LowKlippekort) => {
      const subject = t("dashboard.renewalMailSubject");
      const body = t("dashboard.renewalMailBody", {
        client: kk.client_name ?? t("klippekort.unknownClient"),
        name: kk.name,
        remaining: formatHours(kk.remaining_hours, 1, 0),
        defaultValue:
          'Hej {{client}}\n\nJeg kan se, at dit klippekort "{{name}}" kun har {{remaining}} timer tilbage. For at undgå afbrydelser i arbejdet foreslår jeg, at vi fornyer det med en ny pakke timer.\n\nSig endelig til, hvis det lyder som en god idé, så sender jeg en ny aftale.\n\nMed venlig hilsen',
      });
      const draft = `${subject}\n\n${body}`;
      try {
        await navigator.clipboard.writeText(draft);
        toast.success(t("dashboard.mailDraftCopied"));
      } catch {
        toast.error(t("dashboard.mailDraftFailed"));
      }
    },
    [t],
  );

  // Hide the widget entirely while loading or when nothing needs attention —
  // an empty alert box would just be noise on the dashboard. En fejlet hentning
  // er derimod ikke «intet kræver opmærksomhed»: skjuler den widgetten, lader
  // brugeren et klippekort på vej ud uden at vide det, så fejlen får en synlig
  // tilstand i stedet for at blive en tom tavle.
  if (loading) {
    return null;
  }

  if (loadFailed) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-400" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("dashboard.lowKlippekort")}
          </h3>
        </div>
        <LoadError
          message={t("klippekort.loadFailed")}
          onRetry={() => {
            setLoading(true);
            fetchData();
          }}
          className="py-4"
        />
      </div>
    );
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle size={16} className="text-amber-400" />
        <h3 className="text-sm font-semibold text-(--color-text)">
          {t("dashboard.lowKlippekort")}
        </h3>
        <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
          {items.length}
        </span>
      </div>

      <div className="space-y-2.5">
        {items.map((kk) => (
          <div
            key={kk.id}
            className="rounded-lg border border-(--color-border) bg-(--color-surface) p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-(--color-text)">
                  {kk.client_name ?? t("klippekort.unknownClient")}
                </p>
                <p className="truncate text-[11px] text-(--color-text-muted)">
                  {kk.name}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="flex items-center gap-1 font-mono text-[11px] font-semibold text-amber-400">
                  <Clock size={11} />
                  {formatHours(kk.remaining_hours, 1, 0)}{" "}
                  {t("dashboard.hoursLeft")}
                </span>
                {kk.is_expiring_soon && (
                  <span className="rounded-full bg-orange-500/15 px-1.5 py-0.5 text-[9px] font-medium text-orange-400">
                    {t("dashboard.expiringSoon")}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => copyMailDraft(kk)}
                className="inline-flex items-center gap-1 rounded-md border border-(--color-border) px-2 py-1 text-[11px] text-(--color-text) transition-colors hover:bg-(--color-border)/40"
              >
                <ClipboardCopy size={12} />
                {t("dashboard.copyMailDraft")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
