import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { tauriInvoke } from "@/lib/tauri";

export function TrackingSettings() {
  const { t } = useTranslation();
  const [idleThreshold, setIdleThreshold] = useState("5");
  const [idlePromptEnabled, setIdlePromptEnabled] = useState(true);
  const [idlePromptThreshold, setIdlePromptThreshold] = useState("10");
  const [minActivityDuration, setMinActivityDuration] = useState("5");
  const [mergeGapMinutes, setMergeGapMinutes] = useState("3");
  const [reviewTime, setReviewTime] = useState("17:00");
  const [autoStart, setAutoStart] = useState(false);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [browserCapture, setBrowserCapture] = useState(false);
  const [excludedApps, setExcludedApps] = useState("");
  const [meetingApps, setMeetingApps] = useState("");
  const [meetingMaxIdle, setMeetingMaxIdle] = useState("120");
  const [retentionDays, setRetentionDays] = useState("90");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // `isError` er ikke kosmetik: feltet males i grønt, så uden denne markering viste
  // "Kunne ikke gemme" og "Kunne ikke slette" sig som en succes i emerald.
  const [saveStatus, setSaveStatus] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  useEffect(() => {
    async function loadSettings() {
      try {
        const settings =
          await tauriInvoke<{ key: string; value: string }[]>(
            "get_all_settings",
          );
        const map = new Map(settings.map((s) => [s.key, s.value]));
        setIdleThreshold(map.get("idle_threshold_minutes") ?? "5");
        // Prompt is on unless explicitly disabled.
        setIdlePromptEnabled(map.get("idle_prompt_enabled") !== "false");
        setIdlePromptThreshold(
          map.get("idle_prompt_threshold_minutes") ?? "10",
        );
        setMinActivityDuration(map.get("min_activity_duration") ?? "5");
        const gapSeconds = Number.parseInt(
          map.get("activity_merge_gap_seconds") ?? "180",
          10,
        );
        if (Number.isFinite(gapSeconds) && gapSeconds >= 0) {
          setMergeGapMinutes(String(gapSeconds / 60));
        }
        setReviewTime(map.get("review_reminder_time") ?? "17:00");
        setAutoStart(map.get("auto_start_tracking") === "true");
        setBrowserCapture(map.get("browser_url_capture") === "true");
        setExcludedApps(map.get("excluded_apps") ?? "");
        setMeetingApps(
          map.get("meeting_apps") ??
            "teams, zoom, meet, webex, slack call, google meet, ms teams",
        );
        setMeetingMaxIdle(map.get("meeting_max_idle_minutes") ?? "120");
        setRetentionDays(map.get("activity_retention_days") ?? "90");
      } catch {
        // use defaults
      }
    }
    loadSettings();
    isEnabled()
      .then(setLaunchAtLogin)
      .catch(() => {
        // Plugin unavailable (e.g. dev uden capability) — behold default
      });
  }, []);

  const saveSetting = useCallback(
    async (key: string, value: string) => {
      try {
        await tauriInvoke("set_setting", { key, value });
        setSaveStatus({ text: t("common.saved"), isError: false });
        setTimeout(() => setSaveStatus(null), 2000);
      } catch {
        setSaveStatus({ text: t("tracking.saveFailed"), isError: true });
        setTimeout(() => setSaveStatus(null), 3000);
      }
    },
    [t],
  );

  // Shown in minutes, stored in seconds (activity_merge_gap_seconds)
  async function saveMergeGap() {
    const parsed = Number.parseFloat(mergeGapMinutes);
    const minutes = Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 0), 30)
      : 3;
    setMergeGapMinutes(String(minutes));
    await saveSetting(
      "activity_merge_gap_seconds",
      String(Math.round(minutes * 60)),
    );
  }

  async function handleToggle(
    key: string,
    current: boolean,
    setter: (v: boolean) => void,
  ) {
    const next = !current;
    setter(next);
    await saveSetting(key, String(next));
  }

  async function handleLaunchAtLoginToggle() {
    const next = !launchAtLogin;
    try {
      if (next) {
        await enable();
      } else {
        await disable();
      }
      setLaunchAtLogin(next);
      setSaveStatus({ text: t("common.saved"), isError: false });
      setTimeout(() => setSaveStatus(null), 2000);
    } catch {
      setSaveStatus({ text: t("tracking.saveFailed"), isError: true });
      setTimeout(() => setSaveStatus(null), 3000);
    }
  }

  async function handleDeleteAllActivities() {
    setDeleting(true);
    try {
      await tauriInvoke("delete_all_activities");
      setShowDeleteDialog(false);
      setSaveStatus({ text: t("tracking.deleted"), isError: false });
      setTimeout(() => setSaveStatus(null), 3000);
    } catch {
      setSaveStatus({ text: t("tracking.deleteFailed"), isError: true });
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setDeleting(false);
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

      {/* Idle threshold */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("tracking.idleThreshold")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("tracking.idleThresholdDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={idleThreshold}
            onChange={(e) => setIdleThreshold(e.target.value)}
            onBlur={() => saveSetting("idle_threshold_minutes", idleThreshold)}
            type="number"
            min="1"
            max="60"
            aria-label={t("tracking.idleThreshold")}
            className="w-24"
          />
          <span className="text-sm text-(--color-text-muted)">
            {t("tracking.minutes")}
          </span>
        </div>
      </section>

      {/* Return-from-idle prompt */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              {t("tracking.idlePrompt")}
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {t("tracking.idlePromptDescription")}
            </p>
          </div>
          <ToggleSwitch
            label={t("tracking.idlePrompt")}
            checked={idlePromptEnabled}
            onChange={() => {
              const next = !idlePromptEnabled;
              setIdlePromptEnabled(next);
              saveSetting("idle_prompt_enabled", String(next));
            }}
          />
        </div>
        {idlePromptEnabled && (
          <div className="flex items-center gap-2">
            <Input
              aria-label={t("tracking.idlePromptThreshold")}
              value={idlePromptThreshold}
              onChange={(e) => setIdlePromptThreshold(e.target.value)}
              onBlur={() =>
                saveSetting(
                  "idle_prompt_threshold_minutes",
                  idlePromptThreshold,
                )
              }
              type="number"
              min="1"
              max="240"
              className="w-24"
            />
            <span className="text-sm text-(--color-text-muted)">
              {t("tracking.idlePromptThreshold")}
            </span>
          </div>
        )}
      </section>

      {/* Minimum activity duration */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("tracking.minActivityDuration")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("tracking.minActivityDurationDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={minActivityDuration}
            onChange={(e) => setMinActivityDuration(e.target.value)}
            onBlur={() =>
              saveSetting("min_activity_duration", minActivityDuration)
            }
            type="number"
            min="1"
            max="120"
            aria-label={t("tracking.minActivityDuration")}
            className="w-24"
          />
          <span className="text-sm text-(--color-text-muted)">
            {t("tracking.seconds")}
          </span>
        </div>
      </section>

      {/* Activity merge gap */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("tracking.mergeGap")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("tracking.mergeGapDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={mergeGapMinutes}
            onChange={(e) => setMergeGapMinutes(e.target.value)}
            onBlur={saveMergeGap}
            type="number"
            min="0"
            max="30"
            aria-label={t("tracking.mergeGap")}
            className="w-24"
          />
          <span className="text-sm text-(--color-text-muted)">
            {t("tracking.minutes")}
          </span>
        </div>
      </section>

      {/* Review reminder */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("tracking.reviewReminder")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("tracking.reviewReminderDescription")}
          </p>
        </div>
        <Input
          value={reviewTime}
          onChange={(e) => setReviewTime(e.target.value)}
          onBlur={() => saveSetting("review_reminder_time", reviewTime)}
          type="time"
          aria-label={t("tracking.reviewReminder")}
          className="w-32"
        />
      </section>

      {/* Launch at login */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              {t("tracking.launchAtLogin")}
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {t("tracking.launchAtLoginDescription")}
            </p>
          </div>
          <ToggleSwitch
            label={t("tracking.launchAtLogin")}
            checked={launchAtLogin}
            onChange={handleLaunchAtLoginToggle}
          />
        </div>
      </section>

      {/* Auto-start */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              {t("tracking.autoStartTracking")}
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {t("tracking.autoStartDescription")}
            </p>
          </div>
          <ToggleSwitch
            label={t("tracking.autoStartTracking")}
            checked={autoStart}
            onChange={() =>
              handleToggle("auto_start_tracking", autoStart, setAutoStart)
            }
          />
        </div>
      </section>

      {/* Browser URL capture */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-(--color-text)">
              {t("tracking.browserUrlCapture")}
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {t("tracking.browserUrlDescription")}
            </p>
          </div>
          <ToggleSwitch
            label={t("tracking.browserUrlCapture")}
            checked={browserCapture}
            onChange={() =>
              handleToggle(
                "browser_url_capture",
                browserCapture,
                setBrowserCapture,
              )
            }
          />
        </div>
      </section>

      {/* Excluded apps */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("tracking.excludedApps")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("tracking.excludedAppsDescription")}
          </p>
        </div>
        <textarea
          aria-label={t("tracking.excludedApps")}
          value={excludedApps}
          onChange={(e) => setExcludedApps(e.target.value)}
          onBlur={() => saveSetting("excluded_apps", excludedApps)}
          rows={4}
          placeholder={"Spotify\nSlack\nDiscord"}
          className="w-full rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/60 transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20 resize-none"
        />
      </section>

      {/* Meeting apps whitelist */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("tracking.meetingApps")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("tracking.meetingAppsDescription")}
          </p>
        </div>
        <textarea
          aria-label={t("tracking.meetingApps")}
          value={meetingApps}
          onChange={(e) => setMeetingApps(e.target.value)}
          onBlur={() => saveSetting("meeting_apps", meetingApps)}
          rows={3}
          placeholder={"Teams\nZoom\nMeet"}
          className="w-full rounded-md border border-(--color-border) bg-(--color-bg) px-3 py-2 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/60 transition-colors focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20 resize-none"
        />
        <div className="flex items-center gap-2">
          <Input
            aria-label={t("tracking.meetingMaxIdle")}
            value={meetingMaxIdle}
            onChange={(e) => setMeetingMaxIdle(e.target.value)}
            onBlur={() =>
              saveSetting("meeting_max_idle_minutes", meetingMaxIdle)
            }
            type="number"
            min="1"
            max="480"
            className="w-24"
          />
          <span className="text-sm text-(--color-text-muted)">
            {t("tracking.meetingMaxIdleDescription")}
          </span>
        </div>
      </section>

      {/* Activity retention */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("tracking.retentionTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("tracking.retentionDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label={t("tracking.retentionTitle")}
            value={retentionDays}
            onChange={(e) => {
              setRetentionDays(e.target.value);
              saveSetting("activity_retention_days", e.target.value);
            }}
            className="h-9 rounded-md border border-(--color-border) bg-(--color-bg) px-3 text-sm text-(--color-text) focus:border-(--color-accent) focus:outline-none focus:ring-2 focus:ring-(--color-accent)/20"
          >
            <option value="30">{t("tracking.retention30")}</option>
            <option value="90">{t("tracking.retention90")}</option>
            <option value="180">{t("tracking.retention180")}</option>
            <option value="365">{t("tracking.retention365")}</option>
            <option value="0">{t("tracking.retentionNever")}</option>
          </select>
        </div>
      </section>

      {/* Danger zone */}
      <section className="space-y-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4">
        <div>
          <h3 className="text-sm font-semibold text-red-400">
            {t("tracking.dangerZone")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("tracking.dangerZoneDescription")}
          </p>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-(--color-text)">
              {t("tracking.deleteAllActivities")}
            </p>
            <p className="text-xs text-(--color-text-muted)">
              {t("tracking.deleteAllDescription")}
            </p>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
          >
            <AlertTriangle size={14} />
            {t("tracking.deleteData")}
          </Button>
        </div>
      </section>

      {/* Delete confirmation dialog */}
      <Dialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        title={t("tracking.deleteConfirmTitle")}
        footer={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowDeleteDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteAllActivities}
              disabled={deleting}
            >
              {deleting
                ? t("tracking.deleting")
                : t("tracking.deleteConfirmBtn")}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-(--color-text)">
          {t("tracking.deleteConfirmText")}
        </p>
        <p className="mt-2 text-sm font-medium text-red-400">
          {t("tracking.deleteConfirmWarning")}
        </p>
      </Dialog>
    </div>
  );
}

// Reusable toggle switch component
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
