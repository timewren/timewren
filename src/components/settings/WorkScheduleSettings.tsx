"use client";

import { useTranslations } from "next-intl";
import {
  fmtHours,
  useCoverageFormat,
} from "@/components/coverage/coverage-format";
import { AutoSaveStatus } from "@/components/ui/AutoSaveStatus";
import { useAutoSave } from "@/hooks/useAutoSave";
import {
  DEFAULT_DAILY_HOURS,
  ISO_WEEKDAYS,
  type IsoWeekday,
  MAX_HOURS_PER_DAY,
} from "@/lib/coverage/coverage";
import { trpc } from "@/providers/trpc-provider";

const DAY_KEYS: Record<IsoWeekday, string> = {
  "1": "mon",
  "2": "tue",
  "3": "wed",
  "4": "thu",
  "5": "fri",
  "6": "sat",
  "7": "sun",
};

const DEFAULT_THRESHOLD = 80;

type Draft = Record<IsoWeekday, string>;
type Form = Draft & { reminderOn: boolean; threshold: string };

/** "7,4" og "7.4" → 7.4; tomt felt = 0; ugyldigt = null */
function parseHours(value: string): number | null {
  const v = value.trim().replace(",", ".");
  if (v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= MAX_HOURS_PER_DAY ? n : null;
}

const DEFAULT_SCHEDULE = Object.fromEntries(
  ISO_WEEKDAYS.map((d) => [d, Number(d) <= 5 ? DEFAULT_DAILY_HOURS : 0]),
) as Record<IsoWeekday, number>;

function scheduleValid(draft: Draft): boolean {
  const hours = ISO_WEEKDAYS.map((d) => parseHours(draft[d]));
  if (hours.some((n) => n === null)) return false;
  return hours.reduce<number>((sum, n) => sum + (n ?? 0), 0) > 0;
}

function thresholdValid(threshold: string): boolean {
  const n = Number(threshold);
  return Number.isInteger(n) && n >= 1 && n <= 100;
}

function toDraft(schedule: Record<IsoWeekday, number>): Draft {
  const out = {} as Draft;
  for (const d of ISO_WEEKDAYS) {
    out[d] = String(schedule[d]).replace(".", ",");
  }
  return out;
}

/**
 * Normal arbejdstid pr. ugedag + valgfri påmindelse ved lav dækningsgrad
 * (#679). Er brugeren medarbejder i en org med HR-modulet, bruges HR-
 * normtiden i stedet, og skemaet her vises ikke.
 */
export function WorkScheduleSettings() {
  const t = useTranslations("settingsSchedule.work");
  const fmt = useCoverageFormat();
  const tDays = useTranslations("settingsSchedule.days");
  const dayLabel = (d: IsoWeekday) => tDays(DAY_KEYS[d]);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.coverage.getSettings.useQuery();

  const save = trpc.coverage.updateSettings.useMutation({
    onSuccess: () => {
      utils.coverage.getSettings.invalidate();
      utils.coverage.getSummary.invalidate();
      // Arbejdsdagene deles med tidsblok-forslagene
      utils.calendar.getTimeBlockSuggestions.invalidate();
    },
  });

  const isHr = data?.source === "hr";
  // Hele skemaet sendes samlet, så intet gemmes, mens et felt er ugyldigt
  const form = useAutoSave<Form>({
    defaults: {
      ...toDraft(DEFAULT_SCHEDULE),
      reminderOn: false,
      threshold: String(DEFAULT_THRESHOLD),
    },
    server: data
      ? {
          ...toDraft(data.schedule),
          reminderOn: data.reminderThreshold != null,
          threshold: String(data.reminderThreshold ?? DEFAULT_THRESHOLD),
        }
      : undefined,
    atomic: true,
    errorTitle: t("saveFailed"),
    validate: (_key, _value, values) => {
      if (!isHr && !scheduleValid(values)) return "ugyldigt skema";
      if (values.reminderOn && !thresholdValid(values.threshold)) {
        return "ugyldig grænse";
      }
      return null;
    },
    save: (_patch, values) =>
      save.mutateAsync({
        // Med HR-normtid gemmes det eksisterende skema uændret
        schedule:
          isHr && data
            ? data.schedule
            : (Object.fromEntries(
                ISO_WEEKDAYS.map((d) => [d, parseHours(values[d]) ?? 0]),
              ) as Record<IsoWeekday, number>),
        reminderThreshold: values.reminderOn ? Number(values.threshold) : null,
      }),
  });

  if (isLoading || !data) return null;

  const draft = form.values;
  const reminderOn = draft.reminderOn;
  const threshold = draft.threshold;
  const parsed = ISO_WEEKDAYS.map((d) => [d, parseHours(draft[d])] as const);
  const invalidDays = parsed.filter(([, n]) => n === null).map(([d]) => d);
  const total = parsed.reduce((sum, [, n]) => sum + (n ?? 0), 0);
  const isThresholdValid = !reminderOn || thresholdValid(threshold);
  // Mindst én dag med arbejdstid (ellers giver dækningsgraden ingen mening)
  const scheduleEmpty = !isHr && invalidDays.length === 0 && total <= 0;

  const resetToDefault = () => {
    form.setMany(toDraft(DEFAULT_SCHEDULE), "now");
  };

  return (
    <form
      id="arbejdstid"
      onSubmit={(e) => {
        e.preventDefault();
        form.flush();
      }}
      className="scroll-mt-20 rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("title")}
        </h2>
        <AutoSaveStatus
          status={form.status}
          onRetry={form.retry}
          blocked={Object.keys(form.errors).length > 0}
        />
      </div>
      <p className="mt-1 mb-5 text-sm text-gray-600 dark:text-gray-400">
        {t("intro")}
      </p>

      {isHr ? (
        <p className="mb-5 rounded-lg bg-brand-50 p-3 text-sm text-brand-900 dark:bg-tt-gran-lys dark:text-brand-200">
          {t("hrManaged", { hours: fmtHours(data.weeklyTotal, fmt) })}
        </p>
      ) : (
        <fieldset className="mb-5">
          <legend className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">
            {t("hoursPerDay")}
          </legend>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {ISO_WEEKDAYS.map((d) => {
              const invalid = invalidDays.includes(d);
              return (
                <div key={d}>
                  <label
                    htmlFor={`work-day-${d}`}
                    className="mb-1 block text-xs text-gray-600 dark:text-gray-400"
                  >
                    {dayLabel(d)}
                  </label>
                  <input
                    id={`work-day-${d}`}
                    inputMode="decimal"
                    value={draft[d]}
                    aria-invalid={invalid}
                    onChange={(e) => form.set(d, e.target.value, "debounce")}
                    onBlur={form.flush}
                    className={`w-full rounded-lg border bg-white px-2 py-1.5 text-right text-sm tabular-nums text-gray-900 focus:outline-none focus:ring-1 dark:bg-gray-900 dark:text-white ${
                      invalid
                        ? "border-red-500 focus:ring-red-500/30"
                        : "border-gray-200 focus:border-brand-500 focus:ring-brand-500/20 dark:border-gray-700"
                    }`}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-gray-700 dark:text-gray-300">
              {t.rich("total", {
                hours: fmtHours(Math.round(total * 100) / 100, fmt),
                b: (chunks) => (
                  <span className="font-semibold tabular-nums">{chunks}</span>
                ),
              })}
            </span>
            <button
              type="button"
              onClick={resetToDefault}
              className="font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              {t("reset")}
            </button>
          </div>
          {scheduleEmpty && (
            <p
              className="mt-1 text-sm text-red-700 dark:text-red-400"
              role="alert"
            >
              {t("scheduleEmpty")}
            </p>
          )}
          {invalidDays.length > 0 && (
            <p
              className="mt-1 text-sm text-red-700 dark:text-red-400"
              role="alert"
            >
              {t("invalidDays", {
                days: invalidDays.map((d) => dayLabel(d)).join(", "),
              })}
            </p>
          )}
        </fieldset>
      )}

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-gray-900 dark:text-white">
          <input
            type="checkbox"
            checked={reminderOn}
            onChange={(e) => form.set("reminderOn", e.target.checked, "now")}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <span>{t("reminder")}</span>
        </label>
        {reminderOn && (
          <div className="ml-6 flex items-center gap-2 text-sm">
            <label
              htmlFor="coverage-threshold"
              className="text-gray-700 dark:text-gray-300"
            >
              {t("under")}
            </label>
            <input
              id="coverage-threshold"
              type="number"
              min={1}
              max={100}
              step={1}
              value={threshold}
              aria-invalid={!isThresholdValid}
              onChange={(e) =>
                form.set("threshold", e.target.value, "debounce")
              }
              onBlur={form.flush}
              className="w-20 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <span className="text-gray-700 dark:text-gray-300">
              {t("percentOfHours")}
            </span>
          </div>
        )}
        {reminderOn && !isThresholdValid && (
          <p
            className="ml-6 text-sm text-red-700 dark:text-red-400"
            role="alert"
          >
            {t("thresholdInvalid")}
          </p>
        )}
        <p className="ml-6 text-xs text-gray-600 dark:text-gray-400">
          {t("reminderNote")}
        </p>
      </div>
    </form>
  );
}
