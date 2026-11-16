"use client";

import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AutoSaveStatus } from "@/components/ui/AutoSaveStatus";
import { useAutoSave } from "@/hooks/useAutoSave";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  type CustomDayOff,
  DAY_OFF_PRESETS,
  type DayOffConfig,
  type DayOffPreset,
  daysOffForYear,
  MAX_DAY_OFF_NAME,
  OPTIONAL_DAY_KEYS,
  type OptionalDayKey,
  type OptionalDaySetting,
  PRESET_OPTIONAL_DAYS,
} from "@/lib/holidays/danish";
import { localizeDayOffName } from "@/lib/holidays/names";
import { copenhagenToday, isDateStr } from "@/lib/time/copenhagen";
import { trpc } from "@/providers/trpc-provider";

export type DayOffScope =
  | { scope: "user" }
  | { scope: "org" }
  | { scope: "department"; departmentId: string };

const SETTING_KEYS: Record<OptionalDaySetting, string> = {
  work: "settingWork",
  half: "settingHalf",
  full: "settingFull",
};

/** "2026-12-24" → "tor. 24. dec." uden Date i lokal tid */
function formatDay(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

const inputClass =
  "rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white";

/**
 * Fridagskalender (#526): forudindstilling, valgfri fridage og egne
 * fridage for én bruger, organisation eller afdeling. Forhåndsvisningen
 * bruger samme beregning som normtid/flex/dækningsgrad.
 */
/** DayOffConfig som type-alias, så useAutoSave kan bruge den. */
type CalendarForm = {
  preset: DayOffConfig["preset"];
  optionalDays: DayOffConfig["optionalDays"];
  customDays: DayOffConfig["customDays"];
};

export function DayOffCalendarEditor({
  scope,
  title,
  description,
}: {
  scope: DayOffScope;
  title: string;
  description: string;
}) {
  const t = useTranslations("settingsSchedule.dayOff");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.dayOff.getCalendar.useQuery(scope);
  const [year, setYear] = useState(() => Number(copenhagenToday().slice(0, 4)));
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [newHalf, setNewHalf] = useState(false);

  const invalidateAll = () => {
    // Fridagene påvirker normtid, flex, dækningsgrad og belægningsgrad
    utils.dayOff.invalidate();
    utils.coverage.invalidate();
    utils.reports.getTeamUtilization.invalidate();
    utils.enterprise.invalidate();
  };

  const save = trpc.dayOff.saveCalendar.useMutation({
    onSuccess: invalidateAll,
  });
  // Hvert valg gemmer straks; kalenderen sendes altid samlet
  const form = useAutoSave<CalendarForm>({
    defaults: {
      preset: "private",
      optionalDays: { ...PRESET_OPTIONAL_DAYS.private },
      customDays: [],
    },
    server: data?.config,
    atomic: true,
    errorTitle: t("saveFailed"),
    save: (_patch, values) => save.mutateAsync({ ...scope, ...values }),
  });
  const draft = form.values;
  const setDraft = (next: DayOffConfig) => form.setMany(next, "now");
  const reset = trpc.dayOff.resetCalendar.useMutation({
    onSuccess: async () => {
      invalidateAll();
      // Vis standardkalenderen, serveren nu giver
      const fresh = await utils.dayOff.getCalendar
        .fetch(scope)
        .catch(() => null);
      if (!fresh) {
        toast.error(t("resetReload"));
        return;
      }
      form.reset(fresh.config);
      toast.success(t("resetDone"));
    },
    onError: (err) => toast.error(err.message || t("resetFailed")),
  });

  const preview = useMemo(
    () => (draft ? daysOffForYear(draft, year) : []),
    [draft, year],
  );

  if (isLoading || !data) return null;
  const readOnly = !data.canEdit;

  const setPreset = (preset: DayOffPreset) =>
    setDraft({
      ...draft,
      preset,
      optionalDays: { ...PRESET_OPTIONAL_DAYS[preset] },
    });
  const setOptional = (key: OptionalDayKey, value: OptionalDaySetting) =>
    setDraft({
      ...draft,
      optionalDays: { ...draft.optionalDays, [key]: value },
    });

  const duplicate = draft.customDays.some((d) => d.date === newDate);
  const canAdd =
    isDateStr(newDate) && newName.trim().length > 0 && !duplicate && !readOnly;
  const addCustom = () => {
    if (!canAdd) return;
    const day: CustomDayOff = {
      date: newDate,
      name: newName.trim().slice(0, MAX_DAY_OFF_NAME),
      isHalfDay: newHalf,
    };
    setDraft({
      ...draft,
      customDays: [...draft.customDays, day].sort((a, b) =>
        a.date.localeCompare(b.date),
      ),
    });
    setNewDate("");
    setNewName("");
    setNewHalf(false);
  };
  const removeCustom = (date: string) =>
    setDraft({
      ...draft,
      customDays: draft.customDays.filter((d) => d.date !== date),
    });

  return (
    <section className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {title}
        </h2>
        {!readOnly && (
          <AutoSaveStatus status={form.status} onRetry={form.retry} />
        )}
      </div>
      <p className="mt-1 mb-5 text-sm text-gray-600 dark:text-gray-400">
        {description}
      </p>

      {readOnly && (
        <p className="mb-5 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {t("readOnly")}
        </p>
      )}

      <fieldset className="mb-6" disabled={readOnly || reset.isPending}>
        <legend className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
          {t("preset")}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DAY_OFF_PRESETS.map((p) => (
            <label
              key={p}
              className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${
                draft.preset === p
                  ? "border-brand-500 bg-brand-50/50 dark:bg-tt-gran-lys"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <input
                type="radio"
                name={`day-off-preset-${scope.scope}`}
                checked={draft.preset === p}
                onChange={() => setPreset(p)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="block font-medium text-gray-900 dark:text-white">
                  {t(p === "private" ? "presetPrivate" : "presetOk24")}
                </span>
                <span className="block text-gray-600 dark:text-gray-400">
                  {t(p === "private" ? "presetPrivateDesc" : "presetOk24Desc")}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mb-6" disabled={readOnly || reset.isPending}>
        <legend className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
          {t("optionalDays")}
        </legend>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {OPTIONAL_DAY_KEYS.map((key) => (
            <div
              key={key}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <label
                htmlFor={`optional-${scope.scope}-${key}`}
                className="text-sm text-gray-900 dark:text-white"
              >
                {t(key)}
              </label>
              <select
                id={`optional-${scope.scope}-${key}`}
                value={draft.optionalDays[key]}
                onChange={(e) =>
                  setOptional(key, e.target.value as OptionalDaySetting)
                }
                className={inputClass}
              >
                {(["work", "half", "full"] as const).map((v) => (
                  <option key={v} value={v}>
                    {t(SETTING_KEYS[v])}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="mb-6" disabled={readOnly || reset.isPending}>
        <legend className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
          {t("customDays")}
        </legend>
        {draft.customDays.length === 0 ? (
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            {t("customEmpty")}
          </p>
        ) : (
          <ul className="mb-3 divide-y divide-gray-100 dark:divide-gray-800">
            {draft.customDays.map((d) => (
              <li
                key={d.date}
                className="flex items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="text-gray-900 dark:text-white">
                  <span className="tabular-nums">{d.date}</span> {d.name}
                  {d.isHalfDay && (
                    <span className="ml-2 text-xs text-gray-600 dark:text-gray-400">
                      {t("halfDayTag")}
                    </span>
                  )}
                </span>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => removeCustom(d.date)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800"
                    aria-label={t("removeDay", { name: d.name })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!readOnly && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label
                htmlFor={`new-day-date-${scope.scope}`}
                className="mb-1 block text-xs text-gray-600 dark:text-gray-400"
              >
                {t("date")}
              </label>
              <input
                id={`new-day-date-${scope.scope}`}
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="min-w-40 flex-1">
              <label
                htmlFor={`new-day-name-${scope.scope}`}
                className="mb-1 block text-xs text-gray-600 dark:text-gray-400"
              >
                {t("name")}
              </label>
              <input
                id={`new-day-name-${scope.scope}`}
                value={newName}
                maxLength={MAX_DAY_OFF_NAME}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                placeholder={t("namePlaceholder")}
                className={`${inputClass} w-full`}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-gray-900 dark:text-white">
              <input
                type="checkbox"
                checked={newHalf}
                onChange={(e) => setNewHalf(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              {t("halfDay")}
            </label>
            <button
              type="button"
              onClick={addCustom}
              disabled={!canAdd}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-white dark:hover:bg-gray-800"
            >
              <Plus className="h-4 w-4" />
              {t("add")}
            </button>
            {duplicate && (
              <p className="w-full text-sm text-red-700 dark:text-red-400">
                {t("duplicate")}
              </p>
            )}
          </div>
        )}
      </fieldset>

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {t("daysInYear", { year, count: preview.length })}
          </h3>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              className="rounded-lg px-2 py-1 text-sm text-brand-700 hover:bg-gray-50 dark:text-brand-400 dark:hover:bg-gray-800"
            >
              {year - 1}
            </button>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              className="rounded-lg px-2 py-1 text-sm text-brand-700 hover:bg-gray-50 dark:text-brand-400 dark:hover:bg-gray-800"
            >
              {year + 1}
            </button>
          </div>
        </div>
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {preview.map((d) => (
            <li key={d.date} className="flex justify-between gap-2">
              <span className="text-gray-900 dark:text-white">
                {localizeDayOffName(d.name, locale)}
              </span>
              <span className="whitespace-nowrap text-gray-600 tabular-nums dark:text-gray-400">
                {formatDay(d.date, locale)}
                {d.isHalfDay ? " (½)" : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {data.isSaved && (
            <button
              type="button"
              disabled={reset.isPending || form.busy}
              onClick={() => reset.mutate(scope)}
              className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <RotateCcw className="h-4 w-4" />
              {t("reset")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
