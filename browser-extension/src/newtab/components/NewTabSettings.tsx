import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import { useModalDialog } from "../../hooks/useModalDialog";
import { renderRich, useT } from "../../i18n";
import { nativeNewTabUrl } from "../../lib/native-newtab";
import { useSettingsStore } from "../../stores/settingsStore";

interface NewTabSettingsProps {
  onClose: () => void;
}

const AVAILABLE_WIDGETS = [
  { id: "clock" },
  { id: "timer" },
  { id: "quickEntry" },
  { id: "todayStats" },
  { id: "recentEntries" },
  { id: "prepaidStatus" },
  { id: "weeklyChart" },
];

export function NewTabSettings({ onClose }: NewTabSettingsProps) {
  const { t } = useT();
  const { settings, updateSettings } = useSettingsStore();
  const dialogRef = useModalDialog(onClose);

  const currentWidgets = settings.newTabWidgets || [];

  const toggleWidget = (widgetId: string) => {
    const newWidgets = currentWidgets.includes(widgetId)
      ? currentWidgets.filter((id) => id !== widgetId)
      : [...currentWidgets, widgetId];

    updateSettings({ newTabWidgets: newWidgets });
  };

  const moveWidget = (widgetId: string, direction: "up" | "down") => {
    const idx = currentWidgets.indexOf(widgetId);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= currentWidgets.length) return;

    const newWidgets = [...currentWidgets];
    newWidgets.splice(idx, 1);
    newWidgets.splice(newIdx, 0, widgetId);
    updateSettings({ newTabWidgets: newWidgets });
  };

  const toggleNewTab = () => {
    updateSettings({ newTabEnabled: !settings.newTabEnabled });
  };

  // Sort widgets: active ones first (in their order), then inactive ones
  const sortedWidgets = [
    ...currentWidgets
      .map((id) => AVAILABLE_WIDGETS.find((w) => w.id === id))
      .filter(Boolean),
    ...AVAILABLE_WIDGETS.filter((w) => !currentWidgets.includes(w.id)),
  ] as typeof AVAILABLE_WIDGETS;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: klik på baggrunden lukker; tastaturet bruger Esc (useModalDialog)
    <div
      className="fixed inset-0 bg-[var(--color-surface-overlay)] flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="newtab-settings-title"
        className="bg-[var(--color-surface-base)] rounded-[14px] shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden border border-[var(--color-border-default)] outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <h2
            id="newtab-settings-title"
            className="text-lg font-semibold text-[var(--color-text-primary)]"
          >
            {t("newtab.settingsDialog.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)] rounded-lg transition-colors"
            aria-label={t("newtab.settingsDialog.close")}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between gap-3 p-4 bg-[var(--color-surface-sunken)] rounded-[14px]">
            <div>
              <div
                id="newtab-enabled-label"
                className="font-medium text-[var(--color-text-primary)]"
              >
                {t("newtab.settingsDialog.enable")}
              </div>
              <div className="text-sm text-[var(--color-text-muted)]">
                {t(
                  nativeNewTabUrl()
                    ? "newtab.settingsDialog.enableHintChrome"
                    : "newtab.settingsDialog.enableHint",
                )}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.newTabEnabled}
              aria-labelledby="newtab-enabled-label"
              onClick={toggleNewTab}
              className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${
                settings.newTabEnabled
                  ? "bg-[var(--tt-gran)]"
                  : "bg-[var(--color-border-strong)]"
              }`}
            >
              {/* BRAND.md: slukket spor --tt-kant, tændt --tt-gran */}
              <div
                className={`absolute top-1 left-0 w-5 h-5 rounded-full transition-transform ${
                  settings.newTabEnabled
                    ? "translate-x-6 bg-[var(--color-on-primary)]"
                    : "translate-x-1 bg-[var(--color-surface-base)]"
                }`}
              />
            </button>
          </div>

          {/* Theme Selection */}
          <div>
            <h3 className="text-sm font-medium text-[var(--color-text-tertiary)] mb-3">
              {t("newtab.settingsDialog.appearance")}
            </h3>
            <label className="flex items-center justify-between gap-3 p-4 bg-[var(--color-surface-sunken)] rounded-[14px]">
              <div>
                <div className="font-medium text-[var(--color-text-primary)]">
                  {t("newtab.settingsDialog.theme")}
                </div>
                <div className="text-sm text-[var(--color-text-muted)]">
                  {t("newtab.settingsDialog.themeHint")}
                </div>
              </div>
              <select
                value={settings.theme}
                onChange={(e) =>
                  updateSettings({
                    theme: e.target.value as "system" | "dark" | "light",
                  })
                }
                className="tt-select shrink-0"
              >
                <option value="system">
                  {t("newtab.settingsDialog.system")}
                </option>
                <option value="dark">{t("newtab.settingsDialog.dark")}</option>
                <option value="light">
                  {t("newtab.settingsDialog.light")}
                </option>
              </select>
            </label>
          </div>

          {/* Widget Selection */}
          <div>
            <h3 className="text-sm font-medium text-[var(--color-text-tertiary)] mb-3">
              {t("newtab.settingsDialog.chooseWidgets")}
            </h3>
            <div className="space-y-2">
              {sortedWidgets.map((widget) => {
                const isSelected = currentWidgets.includes(widget.id);
                const widgetIdx = currentWidgets.indexOf(widget.id);
                return (
                  <div
                    key={widget.id}
                    className={`flex items-center gap-2 p-3 rounded-[14px] border transition-all ${
                      !settings.newTabEnabled
                        ? "opacity-50 cursor-not-allowed bg-[var(--color-surface-sunken)] border-[var(--color-border-subtle)]"
                        : isSelected
                          ? "bg-primary-50 border-primary-600"
                          : "bg-[var(--color-surface-elevated)] border-[var(--color-border-subtle)] hover:border-[var(--color-border-default)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleWidget(widget.id)}
                      disabled={!settings.newTabEnabled}
                      aria-pressed={isSelected}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:cursor-not-allowed"
                    >
                      <div
                        aria-hidden="true"
                        className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                          isSelected
                            ? "bg-primary-600 border-primary-600 text-[var(--color-on-primary)]"
                            : "bg-[var(--color-surface-base)] border-[var(--color-border-strong)] text-transparent"
                        }`}
                      >
                        <Check size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-[var(--color-text-primary)]">
                          {t(`newtab.widgets.${widget.id}.name`)}
                        </div>
                        <div className="text-sm text-[var(--color-text-muted)]">
                          {t(`newtab.widgets.${widget.id}.description`)}
                        </div>
                      </div>
                    </button>

                    {/* Reorder buttons */}
                    {isSelected && settings.newTabEnabled && (
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => moveWidget(widget.id, "up")}
                          disabled={widgetIdx === 0}
                          className="w-6 h-6 inline-flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)] rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title={t("newtab.settingsDialog.moveUp")}
                          aria-label={t("newtab.settingsDialog.moveUpNamed", {
                            name: t(`newtab.widgets.${widget.id}.name`),
                          })}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveWidget(widget.id, "down")}
                          disabled={widgetIdx === currentWidgets.length - 1}
                          className="w-6 h-6 inline-flex items-center justify-center text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)] rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          title={t("newtab.settingsDialog.moveDown")}
                          aria-label={t("newtab.settingsDialog.moveDownNamed", {
                            name: t(`newtab.widgets.${widget.id}.name`),
                          })}
                        >
                          <ArrowDown size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Info */}
          <div className="text-sm text-[var(--color-text-tertiary)] bg-[var(--color-surface-sunken)] p-3 rounded-lg">
            {renderRich(t("newtab.settingsDialog.tip"), "font-semibold")}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--color-border-subtle)]">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-primary-600 text-[var(--color-on-primary)] rounded-lg font-medium hover:bg-primary-700 transition-colors"
          >
            {t("newtab.settingsDialog.saveClose")}
          </button>
        </div>
      </div>
    </div>
  );
}
