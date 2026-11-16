import { AlertCircle, ChevronDown, ExternalLink, Key } from "lucide-react";
import { useState } from "react";
import { deriveWebAppUrl } from "../../config";
import { useT } from "../../i18n";
import { useAuthStore } from "../../stores/authStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { BrandIcon } from "./BrandIcon";
import { ServerConnection } from "./ServerConnection";

export function LoginPrompt() {
  const { t } = useT();
  const [token, setToken] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const {
    setToken: saveToken,
    loginWithOAuth,
    isLoading,
    error,
  } = useAuthStore();
  const { settings } = useSettingsStore();
  const webAppUrl = deriveWebAppUrl(settings.apiUrl);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (token.trim()) {
      await saveToken(token.trim());
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface-base)]">
      <header className="px-4 py-6 bg-[var(--color-surface-elevated)] border-b border-[var(--color-border-default)] text-center">
        <div className="flex justify-center mb-4">
          <BrandIcon size={64} />
        </div>
        <h1 className="text-xl font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
          TimeTrack
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
          {t("popup.login.tagline")}
        </p>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        <ServerConnection />
        <button
          type="button"
          onClick={loginWithOAuth}
          disabled={isLoading}
          className="w-full py-3 px-4 bg-primary-600 text-[var(--color-on-primary)] font-medium rounded-lg hover:bg-primary-700 focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? t("popup.login.connecting") : t("popup.login.connect")}
        </button>

        <p className="mt-3 text-xs text-[var(--color-text-tertiary)] text-center">
          {t("popup.login.secureHint")}
        </p>

        <p className="mt-2 text-xs text-[var(--color-text-tertiary)] text-center">
          {t("popup.login.newHere")}{" "}
          <a
            href={`${webAppUrl}/register`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary-600 hover:underline"
          >
            {t("popup.login.register")}
          </a>
        </p>

        {error && (
          <div className="mt-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle
              size={18}
              className="text-red-500 flex-shrink-0 mt-0.5"
            />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Advanced: manual token paste (fallback) */}
        <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="flex w-full items-center justify-between text-sm font-medium text-[var(--color-text-secondary)]"
          >
            <span>{t("popup.login.advanced")}</span>
            <ChevronDown
              size={16}
              className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>

          {showAdvanced && (
            <form onSubmit={handleManualSubmit} className="mt-3 space-y-3">
              <div className="relative">
                <Key
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                />
                <input
                  id="token"
                  type="password"
                  aria-label={t("popup.login.tokenLabel")}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={t("popup.login.tokenPlaceholder")}
                  className="w-full pl-10 pr-4 py-2.5 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm placeholder:text-[var(--color-text-muted)]"
                  disabled={isLoading}
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || !token.trim()}
                className="w-full py-2.5 px-4 bg-[var(--color-surface-base)] border border-[var(--color-border-strong)] text-[var(--color-text-primary)] font-medium rounded-lg hover:bg-[var(--color-surface-sunken)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading
                  ? t("popup.login.signingIn")
                  : t("popup.login.signInToken")}
              </button>
            </form>
          )}
        </div>
      </main>

      <footer className="p-4 border-t border-[var(--color-border-default)]">
        <button
          type="button"
          onClick={() =>
            window.open(
              `${webAppUrl}/dashboard/settings/integrations`,
              "_blank",
            )
          }
          className="w-full flex items-center justify-center gap-2 py-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          <ExternalLink size={16} />
          {t("popup.login.openSettings")}
        </button>
      </footer>
    </div>
  );
}
