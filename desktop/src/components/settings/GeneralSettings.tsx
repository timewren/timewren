import { getVersion } from "@tauri-apps/api/app";
import { Clock, Cloud, Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/Input";
import { tauriInvoke } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settingsStore";

interface UserInfo {
  name: string;
  email: string;
  cvr: string;
  address: string;
  phone: string;
  hourlyRate: string;
}

export function GeneralSettings() {
  const { t } = useTranslation();
  const { theme, setTheme, language, setLanguage } = useSettingsStore();
  const [userInfo, setUserInfo] = useState<UserInfo>({
    name: "",
    email: "",
    cvr: "",
    address: "",
    phone: "",
    hourlyRate: "",
  });
  // `isError` er ikke kosmetik: feltet males i grønt, så uden denne markering viste
  // "Kunne ikke gemme" og "Kunne ikke slette" sig som en succes i emerald.
  const [saveStatus, setSaveStatus] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);
  const [syncedFromCloud, setSyncedFromCloud] = useState(false);
  const [appVersion, setAppVersion] = useState("");

  const THEME_OPTIONS = [
    { value: "light" as const, label: t("settings.themeLight"), icon: Sun },
    { value: "dark" as const, label: t("settings.themeDark"), icon: Moon },
    {
      value: "system" as const,
      label: t("settings.themeSystem"),
      icon: Monitor,
    },
  ];

  const LANGUAGE_OPTIONS = [
    { value: "da" as const, label: "Dansk" },
    { value: "en" as const, label: "English" },
    { value: "sv" as const, label: "Svenska" },
    { value: "nb" as const, label: "Norsk" },
    { value: "de" as const, label: "Deutsch" },
    { value: "es" as const, label: "Español" },
  ];

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("0.1.0"));
  }, []);

  useEffect(() => {
    async function loadSettings() {
      try {
        const settings =
          await tauriInvoke<{ key: string; value: string }[]>(
            "get_all_settings",
          );
        const map = new Map(settings.map((s) => [s.key, s.value]));
        setUserInfo({
          name: map.get("user_name") ?? "",
          email: map.get("user_email") ?? "",
          cvr: map.get("user_cvr") ?? "",
          address: map.get("user_address") ?? "",
          phone: map.get("user_phone") ?? "",
          hourlyRate: map.get("default_hourly_rate") ?? "",
        });
        setSyncedFromCloud(map.get("profile_synced_from_cloud") === "true");
      } catch {
        // Settings not yet saved — use defaults
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

  function handleUserInfoChange(field: keyof UserInfo, value: string) {
    setUserInfo((prev) => ({ ...prev, [field]: value }));
  }

  function handleUserInfoBlur(field: keyof UserInfo) {
    const settingKeys: Record<keyof UserInfo, string> = {
      name: "user_name",
      email: "user_email",
      cvr: "user_cvr",
      address: "user_address",
      phone: "user_phone",
      hourlyRate: "default_hourly_rate",
    };
    saveSetting(settingKeys[field], userInfo[field]);
  }

  return (
    <div className="space-y-8">
      {/* App version */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-(--color-accent)/10">
          <Clock size={18} className="text-(--color-accent)" />
        </div>
        <div>
          <p className="text-sm font-semibold text-(--color-text)">
            TimeTrack Desktop
          </p>
          <p className="text-xs text-(--color-text-muted)">v{appVersion}</p>
        </div>
      </div>

      {/* Save indicator */}
      {saveStatus && (
        <div
          className={`fixed right-6 top-16 z-50 rounded-md bg-(--color-surface) border border-(--color-border) px-3 py-1.5 text-xs font-medium shadow-lg ${saveStatus.isError ? "text-red-400" : "text-emerald-400"}`}
        >
          {saveStatus.text}
        </div>
      )}

      {/* Theme */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("settings.theme")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("settings.themeDescription")}
          </p>
        </div>
        <div className="flex gap-2">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                theme === value
                  ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)"
                  : "border-(--color-border) bg-(--color-bg) text-(--color-text-muted) hover:border-(--color-text-muted)"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Language */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("settings.language")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("settings.languageDescription")}
          </p>
        </div>
        <div className="flex gap-2">
          {LANGUAGE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setLanguage(value)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                language === value
                  ? "border-(--color-accent) bg-(--color-accent)/10 text-(--color-accent)"
                  : "border-(--color-border) bg-(--color-bg) text-(--color-text-muted) hover:border-(--color-text-muted)"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* User info */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("settings.userInfo")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("settings.userInfoDescription")}
          </p>
          {syncedFromCloud && (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-400">
              <Cloud size={12} />
              {t("settings.syncedFromCloud")}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t("common.name")}
            value={userInfo.name}
            onChange={(e) => handleUserInfoChange("name", e.target.value)}
            onBlur={() => handleUserInfoBlur("name")}
            placeholder={t("settings.fullName")}
          />
          <Input
            label={t("common.email")}
            type="email"
            value={userInfo.email}
            onChange={(e) => handleUserInfoChange("email", e.target.value)}
            onBlur={() => handleUserInfoBlur("email")}
            placeholder={t("settings.emailPlaceholder")}
          />
          <Input
            label={t("projects.cvrNumber")}
            value={userInfo.cvr}
            onChange={(e) => handleUserInfoChange("cvr", e.target.value)}
            onBlur={() => handleUserInfoBlur("cvr")}
            placeholder="12345678"
          />
          <Input
            label={t("common.phone")}
            value={userInfo.phone}
            onChange={(e) => handleUserInfoChange("phone", e.target.value)}
            onBlur={() => handleUserInfoBlur("phone")}
            placeholder="+45 12 34 56 78"
          />
          <div className="col-span-2">
            <Input
              label={t("settings.addressLabel")}
              value={userInfo.address}
              onChange={(e) => handleUserInfoChange("address", e.target.value)}
              onBlur={() => handleUserInfoBlur("address")}
              placeholder={t("settings.addressPlaceholder")}
            />
          </div>
        </div>
      </section>

      {/* Default hourly rate */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("settings.globalRate")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("settings.globalRateDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={userInfo.hourlyRate}
            onChange={(e) => handleUserInfoChange("hourlyRate", e.target.value)}
            onBlur={() => handleUserInfoBlur("hourlyRate")}
            placeholder="750"
            type="number"
            min="0"
            aria-label={t("settings.globalRate")}
            className="w-32"
          />
          <span className="text-sm text-(--color-text-muted)">
            {t("settings.globalRateUnit")}
          </span>
        </div>
      </section>
    </div>
  );
}
