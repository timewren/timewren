import { Calendar, CheckCircle, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { tauriInvoke } from "@/lib/tauri";

export function CalendarIntegration() {
  const { t } = useTranslation();
  const [icalUrl, setIcalUrl] = useState("");
  const [syncStatus, setSyncStatus] = useState<
    "idle" | "syncing" | "success" | "error"
  >("idle");
  const [syncMessage, setSyncMessage] = useState("");
  // `isError` er ikke kosmetik: feltet males i grønt, så en ren streng viste
  // "Fejl ved gemning" som en succes. Samme mønster som IntegrationSettings.
  const [saveStatus, setSaveStatus] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const value = await tauriInvoke<string | null>("get_setting", {
          key: "ical_url",
        });
        if (value) setIcalUrl(value);
      } catch {
        // no URL saved yet
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

  async function handleSync() {
    if (!icalUrl.trim()) {
      setSyncStatus("error");
      setSyncMessage(t("integrations.icalUrlRequired"));
      return;
    }

    setSyncStatus("syncing");
    setSyncMessage("");

    try {
      // Save the URL first
      await tauriInvoke("set_setting", { key: "ical_url", value: icalUrl });

      // Sync calendar events
      const newCount = await tauriInvoke<number>("sync_calendar", {
        url: icalUrl,
      });

      setSyncStatus("success");
      setSyncMessage(
        newCount > 0
          ? t("integrations.icalImported", { count: newCount })
          : t("integrations.icalUpToDate"),
      );
    } catch (err) {
      setSyncStatus("error");
      setSyncMessage(String(err));
    }
  }

  return (
    <section className="space-y-3">
      {saveStatus && (
        <div
          className={`fixed right-6 top-16 z-50 rounded-md bg-(--color-surface) border border-(--color-border) px-3 py-1.5 text-xs font-medium shadow-lg ${saveStatus.isError ? "text-red-400" : "text-emerald-400"}`}
        >
          {saveStatus.text}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-(--color-text)">
          <span className="inline-flex items-center gap-2">
            <Calendar size={16} />
            Google Calendar
          </span>
        </h3>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">
          {t("integrations.icalDescription")}
        </p>
      </div>

      <Input
        label={t("integrations.icalLabel")}
        type="url"
        value={icalUrl}
        onChange={(e) => setIcalUrl(e.target.value)}
        onBlur={() => {
          if (icalUrl) saveSetting("ical_url", icalUrl);
        }}
        placeholder="https://calendar.google.com/calendar/ical/..."
        className="max-w-lg"
      />

      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSync}
          disabled={syncStatus === "syncing"}
        >
          {syncStatus === "syncing" && (
            <Loader2 size={14} className="animate-spin" />
          )}
          {syncStatus === "success" && (
            <CheckCircle size={14} className="text-emerald-400" />
          )}
          {syncStatus === "idle" && <RefreshCw size={14} />}
          {syncStatus === "error" && <RefreshCw size={14} />}
          {t("integrations.icalImportButton")}
        </Button>
        {syncMessage && (
          <span
            className={`text-xs ${syncStatus === "success" ? "text-emerald-400" : "text-red-400"}`}
          >
            {syncMessage}
          </span>
        )}
      </div>
    </section>
  );
}
