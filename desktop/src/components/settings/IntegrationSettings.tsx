import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarIntegration } from "@/components/settings/CalendarIntegration";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { tauriInvoke } from "@/lib/tauri";

export function IntegrationSettings() {
  const { t } = useTranslation();
  const [billyApiKey, setBillyApiKey] = useState("");
  const [billyTestStatus, setBillyTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [billyTestMessage, setBillyTestMessage] = useState("");
  const [saveStatus, setSaveStatus] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const value = await tauriInvoke<string | null>("get_setting", {
          key: "billy_api_key",
        });
        if (value) setBillyApiKey(value);
      } catch {
        // no key saved yet
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

  async function handleTestBilly() {
    setBillyTestStatus("testing");
    setBillyTestMessage("");
    try {
      if (!billyApiKey.trim()) {
        throw new Error(t("integrations.apiKeyRequired"));
      }
      // Verify the key against the Billy API (fetches the organisation name).
      const org = await tauriInvoke<string>("test_billy_connection", {
        apiKey: billyApiKey,
      });
      // Persist the key once the connection is confirmed.
      await tauriInvoke("set_setting", {
        key: "billy_api_key",
        value: billyApiKey,
      });
      setBillyTestStatus("success");
      setBillyTestMessage(t("integrations.connectedTo", { org }));
    } catch (err) {
      setBillyTestStatus("error");
      // `String(err)` ville skrive "Error: " foran vores egen dansk/tysk
      // sætning, fordi den er kastet som et `Error`-objekt. Rust derimod
      // afviser med en ren streng, som skal vises ordret — og den er allerede
      // oversat i `src-tauri/src/i18n.rs`.
      setBillyTestMessage(err instanceof Error ? err.message : String(err));
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

      {/* Google Calendar */}
      <CalendarIntegration />

      {/* Billy */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">Billy</h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("integrations.billyDescription")}
          </p>
        </div>
        <Input
          label={t("settings.apiKey")}
          type="password"
          value={billyApiKey}
          onChange={(e) => setBillyApiKey(e.target.value)}
          onBlur={() => {
            if (billyApiKey) saveSetting("billy_api_key", billyApiKey);
          }}
          placeholder={t("integrations.billyApiKeyPlaceholder")}
          className="max-w-md"
        />
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTestBilly}
            disabled={billyTestStatus === "testing"}
          >
            {billyTestStatus === "testing" && (
              <Loader2 size={14} className="animate-spin" />
            )}
            {billyTestStatus === "success" && (
              <CheckCircle size={14} className="text-emerald-400" />
            )}
            {billyTestStatus === "error" && (
              <XCircle size={14} className="text-red-400" />
            )}
            {t("settings.testConnection")}
          </Button>
          {billyTestMessage && (
            <span
              className={`text-xs ${billyTestStatus === "success" ? "text-emerald-400" : "text-red-400"}`}
            >
              {billyTestMessage}
            </span>
          )}
        </div>
      </section>

      {/* Dinero */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              Dinero
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {t("integrations.dineroDescription")}
            </p>
          </div>
          <span className="rounded-full bg-(--color-border) px-2.5 py-0.5 text-[10px] font-medium text-(--color-text-muted)">
            {t("integrations.comingSoon")}
          </span>
        </div>
        <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-6 text-center">
          <p className="text-sm text-(--color-text-muted)">
            {t("integrations.inDevelopment", { product: "Dinero" })}
          </p>
        </div>
      </section>

      {/* e-conomic */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              e-conomic
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {t("integrations.economicDescription")}
            </p>
          </div>
          <span className="rounded-full bg-(--color-border) px-2.5 py-0.5 text-[10px] font-medium text-(--color-text-muted)">
            {t("integrations.comingSoon")}
          </span>
        </div>
        <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-6 text-center">
          <p className="text-sm text-(--color-text-muted)">
            {t("integrations.inDevelopment", { product: "e-conomic" })}
          </p>
        </div>
      </section>

      {/* Rentemester */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              Rentemester
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {t("integrations.rentemesterDescription")}
            </p>
          </div>
          <span className="rounded-full bg-(--color-border) px-2.5 py-0.5 text-[10px] font-medium text-(--color-text-muted)">
            {t("integrations.comingSoon")}
          </span>
        </div>
        <div className="rounded-lg border border-dashed border-(--color-border) px-4 py-6 text-center">
          <p className="text-sm text-(--color-text-muted)">
            {t("integrations.inDevelopment", { product: "Rentemester" })}
          </p>
        </div>
      </section>
    </div>
  );
}
