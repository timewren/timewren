import { Database, Shield } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { closeSentry, initSentry } from "@/lib/sentry";
import { tauriInvoke } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settingsStore";
import { ContextDiagnostics } from "./ContextDiagnostics";
import { ExclusionRulesManager } from "./ExclusionRulesManager";

export function PrivacySettings() {
  const { t } = useTranslation();
  const sentryEnabled = useSettingsStore((s) => s.sentryEnabled);
  const analyticsEnabled = useSettingsStore((s) => s.analyticsEnabled);
  const setSentryEnabled = useSettingsStore((s) => s.setSentryEnabled);
  const setAnalyticsEnabled = useSettingsStore((s) => s.setAnalyticsEnabled);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [excludeIncognito, setExcludeIncognito] = useState(false);

  useEffect(() => {
    tauriInvoke<{ db_path: string }>("get_database_info")
      .then((info) => setDbPath(info.db_path))
      .catch(() => {
        // Fallback — not critical
      });
    tauriInvoke<string | null>("get_setting", { key: "exclude_incognito" })
      .then((v) => setExcludeIncognito(v === "true" || v === "1"))
      .catch(() => {
        // Defaults to false
      });
  }, []);

  const handleIncognitoToggle = useCallback(() => {
    const next = !excludeIncognito;
    setExcludeIncognito(next);
    tauriInvoke("set_setting", {
      key: "exclude_incognito",
      value: next ? "true" : "false",
    }).catch(() => {
      // Revert on failure
      setExcludeIncognito(!next);
    });
  }, [excludeIncognito]);

  const handleSentryToggle = useCallback(() => {
    const next = !sentryEnabled;
    setSentryEnabled(next);
    if (next) {
      initSentry();
    } else {
      closeSentry();
    }
  }, [sentryEnabled, setSentryEnabled]);

  const handleAnalyticsToggle = useCallback(() => {
    setAnalyticsEnabled(!analyticsEnabled);
  }, [analyticsEnabled, setAnalyticsEnabled]);

  return (
    <div className="space-y-8">
      {/* Error reporting (Sentry) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              {t("privacy.sentryLabel")}
            </h3>
            <p className="mt-0.5 max-w-md text-xs text-(--color-text-muted)">
              {t("privacy.sentryDesc")}
            </p>
          </div>
          <ToggleSwitch
            label={t("privacy.sentryLabel")}
            checked={sentryEnabled}
            onChange={handleSentryToggle}
          />
        </div>
      </section>

      {/* Anonymous usage statistics */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              {t("privacy.analyticsLabel")}
            </h3>
            <p className="mt-0.5 max-w-md text-xs text-(--color-text-muted)">
              {t("privacy.analyticsDesc")}
            </p>
          </div>
          <ToggleSwitch
            label={t("privacy.analyticsLabel")}
            checked={analyticsEnabled}
            onChange={handleAnalyticsToggle}
          />
        </div>
      </section>

      {/* Activity tracking privacy — exclusion */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              {t("privacy.incognitoLabel")}
            </h3>
            <p className="mt-0.5 max-w-md text-xs text-(--color-text-muted)">
              {t("privacy.incognitoDesc")}
            </p>
          </div>
          <ToggleSwitch
            label={t("privacy.incognitoLabel")}
            checked={excludeIncognito}
            onChange={handleIncognitoToggle}
          />
        </div>

        <div className="space-y-2">
          <p className="max-w-md text-xs text-(--color-text-muted)">
            {t("privacy.exclusionRulesDesc")}
          </p>
          <ExclusionRulesManager />
        </div>
      </section>

      {/* Context detection diagnostic (Beta) */}
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("privacy.contextLabel")}
          </h3>
          <p className="mt-0.5 max-w-md text-xs text-(--color-text-muted)">
            {t("privacy.contextDesc")}
          </p>
        </div>
        <ContextDiagnostics />
      </section>

      {/* Data location (info, no toggle) */}
      <section className="space-y-3 rounded-lg border border-(--color-border) bg-(--color-surface) p-4">
        <div className="flex items-center gap-2">
          <Database size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("privacy.dataLocation")}
          </h3>
        </div>

        {dbPath && (
          <p className="break-all rounded-md bg-(--color-bg) px-3 py-2 font-mono text-xs text-(--color-text-muted)">
            {dbPath}
          </p>
        )}

        <ul className="space-y-2 text-xs text-(--color-text-muted)">
          <li className="flex items-start gap-2">
            <Shield size={12} className="mt-0.5 shrink-0 text-emerald-400" />
            {t("privacy.activitiesNeverLeave")}
          </li>
          <li className="flex items-start gap-2">
            <Shield size={12} className="mt-0.5 shrink-0 text-emerald-400" />
            {t("privacy.syncOnlySends")}
          </li>
        </ul>
      </section>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)/50 ${
        checked ? "bg-(--color-accent)" : "bg-(--color-border)"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}
