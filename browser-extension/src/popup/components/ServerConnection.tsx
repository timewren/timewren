import { useId, useState } from "react";
import { DEFAULT_WEB_APP_URL, deriveWebAppUrl } from "../../config";
import { useT } from "../../i18n";
import { connectServer } from "../../server-connection";
import { useSettingsStore } from "../../stores/settingsStore";

export function ServerConnection() {
  const { t } = useT();
  const apiUrl = useSettingsStore((state) => state.settings.apiUrl);
  const server = deriveWebAppUrl(apiUrl);
  const cloud = server === DEFAULT_WEB_APP_URL;
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(cloud ? "" : server);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  const connect = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await connectServer(value);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : t("errors.server.unreachable"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="space-y-3 py-3"
      aria-label={t("settings.server.ariaLabel")}
    >
      <p className="break-words text-sm text-[var(--color-text-primary)]">
        {cloud
          ? t("settings.server.cloud")
          : t("settings.server.connectedTo", { host: new URL(server).host })}
      </p>
      <button
        type="button"
        disabled={busy}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className="min-h-11 text-sm text-primary-600 underline"
      >
        {cloud ? t("settings.server.useOwn") : t("settings.server.switch")}
      </button>
      {expanded && (
        <div className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium">
            {t("settings.server.address")}
          </label>
          <input
            id={inputId}
            type="url"
            value={draft}
            disabled={busy}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            placeholder={t("settings.server.placeholder")}
            aria-invalid={!!error}
            aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ""}`}
            className="min-h-11 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-3 text-sm text-[var(--color-text-primary)]"
          />
          <p
            id={`${inputId}-hint`}
            className="text-xs text-[var(--color-text-secondary)]"
          >
            {t("settings.server.hint")}
          </p>
          {draft.trim().toLowerCase().startsWith("http://") && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {t("settings.server.httpWarning")}
            </p>
          )}
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void connect(draft)}
            className="min-h-11 rounded-lg bg-primary-600 px-4 text-sm font-medium text-[var(--color-on-primary)] disabled:opacity-50"
          >
            {busy
              ? t("settings.server.connecting")
              : t("settings.server.connect")}
          </button>
          {!cloud && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void connect(DEFAULT_WEB_APP_URL)}
              className="min-h-11 block text-sm text-primary-600 underline"
            >
              {t("settings.server.useCloud")}
            </button>
          )}
        </div>
      )}
      {error && (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      )}
    </section>
  );
}
