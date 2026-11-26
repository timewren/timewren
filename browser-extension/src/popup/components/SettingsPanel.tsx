import {
  Bell,
  CalendarDays,
  CreditCard,
  ExternalLink,
  Globe,
  Hash,
  Info,
  Keyboard,
  LayoutGrid,
  Moon,
  RotateCcw,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useModalDialog } from "../../hooks/useModalDialog";
import {
  type LanguageSetting,
  LOCALES,
  type Locale,
  localeOptionLabel,
  useT,
} from "../../i18n";
import { nativeNewTabUrl } from "../../lib/native-newtab";
import { useOfflineStore } from "../../stores/offlineStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSiteStore } from "../../stores/siteStore";
import { InlineConfirm } from "./InlineConfirm";
import { ServerConnection } from "./ServerConnection";

const IS_FIREFOX = import.meta.env.MODE === "firefox";

// Firefox-bygget skal pege på addons.mozilla.org. AMO slår add-on'et op på
// gecko-id'et (manifest.firefox.json), så linket virker uden kendt slug.
const AMO_LANGUAGE: Record<Locale, string> = {
  da: "da",
  en: "en-GB",
  de: "de",
  es: "es",
  sv: "sv-SE",
  nb: "nb-NO",
  fi: "fi",
  nl: "nl",
  fr: "fr",
  it: "it",
  pt: "pt-PT",
  "pt-BR": "pt-BR",
  pl: "pl",
  cs: "cs",
  ja: "ja",
  ko: "ko",
  "zh-Hans": "zh-CN",
  tr: "tr",
};
const reviewUrl = (locale: Locale) =>
  IS_FIREFOX
    ? `https://addons.mozilla.org/${AMO_LANGUAGE[locale]}/firefox/addon/timetrack@timetrack.dk/reviews/`
    : "https://chromewebstore.google.com/detail/omfnfamlmdfaobhcphdfhcnihcllekof/reviews";

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { t, locale } = useT();
  const { settings, loadSettings, updateSettings, resetSettings } =
    useSettingsStore();
  const { mappings } = useSiteStore();
  const { queue, clearQueue } = useOfflineStore();
  const [query, setQuery] = useState("");
  const [shortcuts, setShortcuts] = useState<chrome.commands.Command[]>([]);
  const dialogRef = useModalDialog(onClose);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    chrome.commands
      ?.getAll()
      .then(setShortcuts)
      .catch(() => setShortcuts([]));
  }, []);

  const openShortcutSettings = () => {
    // Firefox (137+) har sin egen side; Chrome åbner chrome://extensions
    const commands = chrome.commands as typeof chrome.commands & {
      openShortcutSettings?: () => Promise<void>;
    };
    if (typeof commands?.openShortcutSettings === "function") {
      void commands.openShortcutSettings();
      return;
    }
    void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  };

  // Sletninger bekræftes i panelet (window.confirm vises ikke i Firefox)
  const [confirming, setConfirming] = useState<
    "mappings" | "queue" | "reset" | null
  >(null);

  const handleClearSiteMappings = async () => {
    setConfirming(null);
    // Skjulte forslag ("skjul altid") nulstilles sammen med mappings
    await chrome.storage.local.remove([
      "siteMappings",
      "dismissedDomains",
      "siteDismissals",
    ]);
    window.location.reload();
  };

  // Usynkroniseret tid i køen er IKKE gemt i TimeTrack — sig det med antal
  const unsentEntries = queue.filter(
    (a) => a.type === "createTimeEntry",
  ).length;
  const handleClearOfflineQueue = () => {
    setConfirming(null);
    clearQueue();
  };

  const handleResetSettings = async () => {
    setConfirming(null);
    await resetSettings();
  };

  // Lightweight search: a section shows when its keywords contain the query.
  // Keeps every setting reachable by typing (e.g. "fane", "badge", "api")
  // without forcing the user to scroll the whole list.
  const q = query.trim().toLowerCase();
  const show = (keywords: string) =>
    q === "" || keywords.split("|").some((k) => k.toLowerCase().includes(q));
  const vis = {
    visning: show(t("settings.keywords.view")),
    udseende: show(t("settings.keywords.appearance")),
    nyfane: show(t("settings.keywords.newTab")),
    kalender: show(t("settings.keywords.calendar")),
    maal: show(t("settings.keywords.goal")),
    paamindelse: show(t("settings.keywords.reminder")),
    data: show(t("settings.keywords.data")),
    avanceret: show(t("settings.keywords.advanced")),
    genveje: show(t("settings.keywords.shortcuts")),
    om: show(t("settings.keywords.about")),
  };
  const anyVisible = Object.values(vis).some(Boolean);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: klik på baggrunden lukker; tastaturet bruger Esc (useModalDialog)
    <div
      className="fixed inset-0 bg-[var(--color-surface-overlay)] z-50 flex items-end justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="w-full bg-[var(--color-surface-elevated)] rounded-t-[14px] max-h-[85%] flex flex-col animate-slide-up outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)]">
          <h2
            id="settings-title"
            className="text-lg font-semibold text-[var(--color-text-primary)]"
          >
            {t("settings.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)] rounded-lg"
            aria-label={t("settings.close")}
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 pt-3 pb-2 border-b border-[var(--color-border-default)]">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("settings.searchPlaceholder")}
              aria-label={t("settings.searchLabel")}
              data-autofocus
              className="w-full pl-9 pr-3 py-2 border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] rounded-lg text-sm placeholder:text-[var(--color-text-muted)]"
            />
          </div>
        </div>

        {/* Settings Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Display Options */}
          {vis.visning && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("settings.view.title")}
              </h3>

              <label className="flex items-center justify-between p-3 bg-[var(--color-surface-sunken)] rounded-lg cursor-pointer">
                <div className="flex items-center gap-3">
                  <Globe
                    size={18}
                    className="shrink-0 text-[var(--color-text-secondary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t("settings.view.suggestions")}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {t("settings.view.suggestionsHint")}
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.showSiteSuggestions}
                  onChange={(e) =>
                    updateSettings({ showSiteSuggestions: e.target.checked })
                  }
                  className="w-5 h-5 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between p-3 bg-[var(--color-surface-sunken)] rounded-lg cursor-pointer">
                <div className="flex items-center gap-3">
                  <CreditCard
                    size={18}
                    className="shrink-0 text-[var(--color-text-secondary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t("settings.view.prepaidTab")}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {t("settings.view.prepaidTabHint")}
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.showPrepaidStatus}
                  onChange={(e) =>
                    updateSettings({ showPrepaidStatus: e.target.checked })
                  }
                  className="w-5 h-5 shrink-0"
                />
              </label>
            </div>
          )}

          {/* Theme & badge */}
          {vis.udseende && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("settings.appearance.title")}
              </h3>

              <label className="flex items-center justify-between p-3 bg-[var(--color-surface-sunken)] rounded-lg">
                <div className="flex items-center gap-3">
                  <Moon
                    size={18}
                    className="shrink-0 text-[var(--color-text-secondary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t("settings.appearance.theme")}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {t("settings.appearance.themeHint")}
                    </p>
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
                    {t("settings.appearance.system")}
                  </option>
                  <option value="dark">{t("settings.appearance.dark")}</option>
                  <option value="light">
                    {t("settings.appearance.light")}
                  </option>
                </select>
              </label>

              <label className="flex items-center justify-between p-3 bg-[var(--color-surface-sunken)] rounded-lg">
                <div className="flex items-center gap-3">
                  <Globe
                    size={18}
                    className="shrink-0 text-[var(--color-text-secondary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t("settings.appearance.language")}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {t("settings.appearance.languageHint")}
                    </p>
                  </div>
                </div>
                <select
                  value={settings.language}
                  onChange={(e) =>
                    updateSettings({
                      language: e.target.value as LanguageSetting,
                    })
                  }
                  className="tt-select shrink-0"
                >
                  <option value="auto">
                    {t("settings.appearance.languageAuto")}
                  </option>
                  {LOCALES.map((code) => (
                    <option key={code} value={code} lang={code}>
                      {localeOptionLabel(code)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center justify-between p-3 bg-[var(--color-surface-sunken)] rounded-lg">
                <div className="flex items-center gap-3">
                  <Hash
                    size={18}
                    className="shrink-0 text-[var(--color-text-secondary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t("settings.appearance.badge")}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {t("settings.appearance.badgeHint")}
                    </p>
                  </div>
                </div>
                <select
                  value={settings.badgeDisplay}
                  onChange={(e) =>
                    updateSettings({
                      badgeDisplay: e.target.value as "timer" | "today" | "off",
                    })
                  }
                  className="tt-select shrink-0"
                >
                  <option value="timer">
                    {t("settings.appearance.badgeTimer")}
                  </option>
                  <option value="today">
                    {t("settings.appearance.badgeToday")}
                  </option>
                  <option value="off">
                    {t("settings.appearance.badgeOff")}
                  </option>
                </select>
              </label>
            </div>
          )}

          {/* New Tab */}
          {vis.nyfane && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("settings.newTab.title")}
              </h3>

              <label className="flex items-center justify-between p-3 bg-[var(--color-surface-sunken)] rounded-lg cursor-pointer">
                <div className="flex items-center gap-3">
                  <LayoutGrid
                    size={18}
                    className="shrink-0 text-[var(--color-text-secondary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t("settings.newTab.enable")}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {t(
                        nativeNewTabUrl()
                          ? "settings.newTab.enableHintChrome"
                          : "settings.newTab.enableHint",
                      )}
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.newTabEnabled}
                  onChange={(e) =>
                    updateSettings({ newTabEnabled: e.target.checked })
                  }
                  className="w-5 h-5 shrink-0"
                />
              </label>

              {settings.newTabEnabled && (
                <div className="ml-4 pl-4 border-l-2 border-[var(--color-border-default)] text-xs text-[var(--color-text-tertiary)]">
                  <p>{t("settings.newTab.widgetsHint")}</p>
                  <p className="mt-1">
                    {t("settings.newTab.activeWidgets", {
                      count: (settings.newTabWidgets || []).length,
                    })}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Calendar */}
          {vis.kalender && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("settings.calendar.title")}
              </h3>

              <label className="flex items-center justify-between p-3 bg-[var(--color-surface-sunken)] rounded-lg">
                <div className="flex items-center gap-3">
                  <CalendarDays
                    size={18}
                    className="shrink-0 text-[var(--color-text-secondary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t("settings.calendar.openOn")}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {t("settings.calendar.openOnHint")}
                    </p>
                  </div>
                </div>
                <select
                  value={settings.calendarDefaultDay}
                  onChange={(e) =>
                    updateSettings({
                      calendarDefaultDay: e.target.value as
                        | "today"
                        | "last-viewed",
                    })
                  }
                  className="tt-select shrink-0"
                >
                  <option value="today">{t("settings.calendar.today")}</option>
                  <option value="last-viewed">
                    {t("settings.calendar.lastViewed")}
                  </option>
                </select>
              </label>
            </div>
          )}

          {/* Daily Goal */}
          {vis.maal && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("settings.goal.title")}
              </h3>
              <label className="flex items-center justify-between p-3 bg-[var(--color-surface-sunken)] rounded-lg">
                <div className="flex items-center gap-3">
                  <Bell
                    size={18}
                    className="shrink-0 text-[var(--color-text-secondary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t("settings.goal.hours")}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {t("settings.goal.hoursHint")}
                    </p>
                  </div>
                </div>
                <select
                  value={settings.dailyGoalHours}
                  onChange={(e) =>
                    updateSettings({
                      dailyGoalHours: Number(e.target.value),
                    })
                  }
                  className="tt-select shrink-0"
                >
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((h) => (
                    <option key={h} value={h}>
                      {t("format.hours", { value: h })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* Daily Reminder */}
          {vis.paamindelse && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("settings.reminder.title")}
              </h3>

              <label className="flex items-center justify-between p-3 bg-[var(--color-surface-sunken)] rounded-lg cursor-pointer">
                <div className="flex items-center gap-3">
                  <Bell
                    size={18}
                    className="shrink-0 text-[var(--color-text-secondary)]"
                  />
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t("settings.reminder.enable")}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {t("settings.reminder.enableHint")}
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.reminderEnabled}
                  onChange={(e) =>
                    updateSettings({ reminderEnabled: e.target.checked })
                  }
                  className="w-5 h-5 shrink-0"
                />
              </label>

              {settings.reminderEnabled && (
                <div className="ml-4 pl-4 border-l-2 border-[var(--color-border-default)] space-y-2">
                  <label className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {t("settings.reminder.time")}
                    </span>
                    <select
                      value={settings.reminderHour}
                      onChange={(e) =>
                        updateSettings({
                          reminderHour: Number(e.target.value),
                        })
                      }
                      className="tt-select text-xs"
                    >
                      <option value={14}>14:00</option>
                      <option value={15}>15:00</option>
                      <option value={16}>16:00</option>
                      <option value={17}>17:00</option>
                      <option value={18}>18:00</option>
                    </select>
                  </label>
                  <label className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {t("settings.reminder.minHours")}
                    </span>
                    <select
                      value={settings.reminderThreshold}
                      onChange={(e) =>
                        updateSettings({
                          reminderThreshold: Number(e.target.value),
                        })
                      }
                      className="tt-select text-xs"
                    >
                      <option value={2}>
                        {t("format.hours", { value: 2 })}
                      </option>
                      <option value={3}>
                        {t("format.hours", { value: 3 })}
                      </option>
                      <option value={4}>
                        {t("format.hours", { value: 4 })}
                      </option>
                      <option value={5}>
                        {t("format.hours", { value: 5 })}
                      </option>
                      <option value={6}>
                        {t("format.hours", { value: 6 })}
                      </option>
                      <option value={7}>
                        {t("format.hours", { value: 7 })}
                      </option>
                      <option value={8}>
                        {t("format.hours", { value: 8 })}
                      </option>
                    </select>
                  </label>
                  <label className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {t("settings.reminder.weekends")}
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.reminderWeekends}
                      onChange={(e) =>
                        updateSettings({
                          reminderWeekends: e.target.checked,
                        })
                      }
                      className="w-4 h-4 shrink-0"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Data Management */}
          {vis.data && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("settings.data.title")}
              </h3>

              <div className="space-y-2">
                {confirming === "mappings" && (
                  <InlineConfirm
                    message={t("settings.data.clearMappingsConfirm")}
                    details={[t("settings.data.clearMappingsDetail")]}
                    confirmLabel={t("settings.data.delete")}
                    onConfirm={handleClearSiteMappings}
                    onCancel={() => setConfirming(null)}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setConfirming("mappings")}
                  className="w-full flex items-center justify-between p-3 bg-[var(--color-surface-sunken)] rounded-lg hover:bg-primary-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Trash2
                      size={18}
                      className="text-[var(--color-text-tertiary)]"
                    />
                    <div className="text-left">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">
                        {t("settings.data.clearMappings")}
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        {t("settings.data.mappingsCount", {
                          count: mappings.length,
                        })}
                      </p>
                    </div>
                  </div>
                </button>

                {confirming === "queue" && (
                  <InlineConfirm
                    message={t("settings.data.clearQueueConfirm", {
                      count: queue.length,
                    })}
                    details={
                      unsentEntries > 0
                        ? [
                            t("settings.data.unsentEntries", {
                              count: unsentEntries,
                            }),
                          ]
                        : []
                    }
                    confirmLabel={t("settings.data.clearQueueConfirmButton")}
                    onConfirm={handleClearOfflineQueue}
                    onCancel={() => setConfirming(null)}
                  />
                )}
                {queue.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirming("queue")}
                    className="w-full flex items-center justify-between p-3 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Trash2 size={18} className="text-amber-600" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">
                          {t("settings.data.clearQueue")}
                        </p>
                        <p className="text-xs text-[var(--color-warning-text)]">
                          {t("settings.data.pendingActions", {
                            count: queue.length,
                          })}
                          {unsentEntries > 0 &&
                            `, ${t("settings.data.unsentSuffix", { count: unsentEntries })}`}
                        </p>
                      </div>
                    </div>
                  </button>
                )}

                {confirming === "reset" && (
                  <InlineConfirm
                    message={t("settings.data.resetConfirm")}
                    details={[t("settings.data.resetDetail")]}
                    confirmLabel={t("settings.data.resetButton")}
                    onConfirm={handleResetSettings}
                    onCancel={() => setConfirming(null)}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setConfirming("reset")}
                  className="w-full flex items-center justify-between p-3 bg-[var(--color-surface-sunken)] rounded-lg hover:bg-primary-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <RotateCcw
                      size={18}
                      className="text-[var(--color-text-tertiary)]"
                    />
                    <div className="text-left">
                      <p className="text-sm font-medium text-[var(--color-text-primary)]">
                        {t("settings.data.reset")}
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        {t("settings.data.resetHint")}
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Advanced */}
          {vis.avanceret && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("settings.advanced.title")}
              </h3>

              <ServerConnection />
            </div>
          )}

          {/* Keyboard shortcuts */}
          {vis.genveje && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--color-text-primary)]">
                {t("settings.shortcuts.title")}
              </h3>
              <div className="p-3 bg-[var(--color-surface-sunken)] rounded-lg space-y-1.5">
                {shortcuts.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {t("settings.shortcuts.unreadable")}
                  </p>
                ) : (
                  shortcuts.map((command) => (
                    <div
                      key={command.name}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {command.name === "_execute_action"
                          ? t("settings.shortcuts.openApp")
                          : command.description}
                      </span>
                      <kbd className="text-xs font-medium text-[var(--color-text-primary)] bg-[var(--color-surface-elevated)] border border-[var(--color-border-strong)] rounded px-1.5 py-0.5 whitespace-nowrap">
                        {command.shortcut || t("settings.shortcuts.notSet")}
                      </kbd>
                    </div>
                  ))
                )}
              </div>
              <button
                type="button"
                onClick={openShortcutSettings}
                className="w-full flex items-center gap-3 p-3 bg-[var(--color-surface-sunken)] rounded-lg hover:bg-primary-50 transition-colors text-left"
              >
                <Keyboard
                  size={18}
                  className="shrink-0 text-[var(--color-text-secondary)]"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {t("settings.shortcuts.change")}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {IS_FIREFOX
                      ? t("settings.shortcuts.firefoxPage")
                      : t("settings.shortcuts.chromePage")}
                  </p>
                </div>
                <ExternalLink
                  size={14}
                  className="ml-auto text-[var(--color-text-muted)]"
                />
              </button>
            </div>
          )}

          {/* About */}
          {vis.om && (
            <div className="pt-4 border-t border-[var(--color-border-default)] space-y-3">
              <div className="flex items-center gap-3 text-[var(--color-text-tertiary)]">
                <Info size={16} />
                <div>
                  <p className="text-xs">
                    {t("settings.about.version", {
                      version: chrome.runtime.getManifest().version,
                    })}
                  </p>
                  <p className="text-xs">© 2026 TimeTrack</p>
                </div>
              </div>

              <a
                href={reviewUrl(locale)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-[var(--color-surface-sunken)] rounded-lg hover:bg-primary-50 transition-colors"
              >
                <Star
                  size={18}
                  className="shrink-0 text-[var(--color-text-secondary)]"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {IS_FIREFOX
                      ? t("settings.about.rateFirefox")
                      : t("settings.about.rateChrome")}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    {t("settings.about.rateHint")}
                  </p>
                </div>
                <ExternalLink
                  size={14}
                  className="ml-auto text-[var(--color-text-muted)]"
                />
              </a>

              <a
                href="https://timetrack.dk/browser-extension"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 bg-[var(--color-surface-sunken)] rounded-lg hover:bg-primary-50 transition-colors"
              >
                <Globe
                  size={18}
                  className="shrink-0 text-[var(--color-text-secondary)]"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {t("settings.about.learnMore")}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">
                    timetrack.dk/browser-extension
                  </p>
                </div>
                <ExternalLink
                  size={14}
                  className="ml-auto text-[var(--color-text-muted)]"
                />
              </a>
            </div>
          )}

          {/* No search results */}
          {!anyVisible && (
            <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
              {t("settings.noMatch", { query })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
