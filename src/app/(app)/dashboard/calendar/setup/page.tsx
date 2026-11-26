"use client";

import {
  ArrowRight,
  Calendar,
  Check,
  ChevronLeft,
  Filter,
  Loader2,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useBrand } from "@/components/BrandContext";
import { trpc } from "@/providers/trpc-provider";

type Step = "filters" | "calendars" | "autotrack" | "done";
const STEPS: Step[] = ["filters", "calendars", "autotrack", "done"];

export default function CalendarSetupPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const fid = useId();
  const t = useTranslations("calendar");
  const router = useRouter();
  const [step, setStep] = useState<Step>("filters");

  // Filter state
  const [ignoreWords, setIgnoreWords] = useState("");
  const [minDuration, setMinDuration] = useState(5);
  const [ignoreAllDay, setIgnoreAllDay] = useState(true);
  const [onlyAccepted, setOnlyAccepted] = useState(false);

  // Calendar selection state
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(
    new Set(),
  );
  const [calendarsInitialized, setCalendarsInitialized] = useState(false);

  // Auto-track state
  const [autoTrackMode, setAutoTrackMode] = useState<
    "off" | "suggest" | "auto"
  >("suggest");

  const updateFilters = trpc.calendar.updateSyncFilters.useMutation();
  const selectCalendars = trpc.calendar.selectCalendars.useMutation();
  const updateAutoTrack = trpc.calendar.updateAutoTrackMode.useMutation();
  const syncMutation = trpc.calendar.sync.useMutation();
  const { data: connectionStatus } = trpc.calendar.getConnectionStatus.useQuery(
    undefined,
    { retry: false },
  );
  // iCloud-kalendere vælges på integrationssiden — her kun Google
  const isGoogle = connectionStatus?.provider === "google";

  const { data: calendars, isLoading: calendarsLoading } =
    trpc.calendar.listCalendars.useQuery(undefined, {
      enabled: step === "calendars" && isGoogle,
    });

  // Pre-check primary calendar when data first loads
  if (calendars && !calendarsInitialized) {
    const primaryIds = new Set<string>();
    for (const c of calendars) {
      if (c.primary && c.id) primaryIds.add(c.id);
    }
    if (primaryIds.size === 0 && calendars.length > 0 && calendars[0].id) {
      primaryIds.add(calendars[0].id);
    }
    setSelectedCalendarIds(primaryIds);
    setCalendarsInitialized(true);
  }

  const toggleCalendar = (id: string) => {
    setSelectedCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const currentStepIndex = STEPS.indexOf(step);

  const handleNext = async () => {
    if (step === "filters") {
      const words = ignoreWords
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean);
      await updateFilters.mutateAsync({
        ignoreWords: words.length > 0 ? words : undefined,
        minDurationMinutes: minDuration,
        ignoreAllDay,
        onlyAccepted,
      });
      setStep("calendars");
    } else if (step === "calendars") {
      if (isGoogle && calendars) {
        const selected = calendars
          .filter((c) => c.id && selectedCalendarIds.has(c.id))
          .map((c) => ({
            calendarId: c.id as string,
            calendarName: c.name || c.id || "Unknown",
            calendarColor: c.backgroundColor || undefined,
          }));
        // Always call — even with empty selection — so previously-created
        // child connections get cleaned up when the user deselects everything.
        await selectCalendars.mutateAsync({ calendars: selected });
      }
      setStep("autotrack");
    } else if (step === "autotrack") {
      await updateAutoTrack.mutateAsync({ mode: autoTrackMode });
      // Run initial sync
      syncMutation.mutate();
      setStep("done");
    } else {
      router.push("/dashboard/calendar");
    }
  };

  const isSaving =
    updateFilters.isPending ||
    selectCalendars.isPending ||
    updateAutoTrack.isPending;

  return (
    <div className="mx-auto max-w-lg space-y-6 py-8">
      {/* Progress indicator */}
      <div className="flex items-center justify-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                i < currentStepIndex
                  ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                  : i === currentStepIndex
                    ? "bg-tt-gran text-tt-paa-gran"
                    : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
              }`}
            >
              {i < currentStepIndex ? <Check className="h-4 w-4" /> : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-0.5 w-8 ${
                  i < currentStepIndex
                    ? "bg-green-300 dark:bg-green-700"
                    : "bg-gray-200 dark:bg-gray-700"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        {step === "filters" && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
                <Filter className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  {t("setup.filterTitle")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("setup.filterDesc")}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label
                  htmlFor={`${fid}-f1`}
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("setup.ignoreWords")}
                </label>
                <input
                  id={`${fid}-f1`}
                  type="text"
                  value={ignoreWords}
                  onChange={(e) => setIgnoreWords(e.target.value)}
                  placeholder={t("setup.ignoreWordsPlaceholder")}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
                <p className="mt-1 text-xs text-gray-400">
                  {t("setup.separateWithComma")}
                </p>
              </div>

              <div>
                <label
                  htmlFor={`${fid}-f2`}
                  className="block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("setup.minDuration")}
                </label>
                <input
                  id={`${fid}-f2`}
                  type="number"
                  value={minDuration}
                  onChange={(e) =>
                    setMinDuration(Math.max(0, Number(e.target.value)))
                  }
                  min={0}
                  max={120}
                  className="mt-1 w-24 rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
                <p className="mt-1 text-xs text-gray-400">
                  {t("setup.minDurationHint")}
                </p>
              </div>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={ignoreAllDay}
                  onChange={(e) => setIgnoreAllDay(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t("setup.ignoreAllDay")}
                </span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={onlyAccepted}
                  onChange={(e) => setOnlyAccepted(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t("setup.onlyAccepted")}
                </span>
              </label>
            </div>
          </>
        )}

        {step === "calendars" && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/50">
                <Calendar className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  {t("setup.chooseCalendars")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("setup.chooseCalendarsDesc", { brand: brand.name })}
                </p>
              </div>
            </div>

            <div className="mt-6">
              {!isGoogle ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {t.rich(
                    connectionStatus?.provider === "outlook"
                      ? "setup.outlookNote"
                      : "setup.icloudNote",
                    {
                      brand: brand.name,
                      link: (chunks) => (
                        <Link
                          href="/dashboard/settings/integrations"
                          className="font-medium text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {chunks}
                        </Link>
                      ),
                    },
                  )}
                </p>
              ) : calendarsLoading ? (
                <div className="flex items-center gap-2 py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-gray-500">
                    {t("setup.loadingCalendars")}
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  {calendars
                    ?.filter((cal) => cal.id)
                    .map((cal) => (
                      <label
                        key={cal.id}
                        className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedCalendarIds.has(cal.id as string)}
                          onChange={() => toggleCalendar(cal.id as string)}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{
                            backgroundColor: cal.backgroundColor || "#4285f4",
                          }}
                        />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {cal.name || cal.id}
                        </span>
                        {cal.primary && (
                          <span className="text-xs text-gray-400">
                            {t("setup.primary")}
                          </span>
                        )}
                      </label>
                    ))}
                </div>
              )}
            </div>
          </>
        )}

        {step === "autotrack" && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50">
                <Zap className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  {t("setup.autoTitle")}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t("setup.autoDesc")}
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {(
                [
                  {
                    value: "off" as const,
                    label: t("setup.modeOff"),
                    desc: t("setup.modeOffDesc"),
                  },
                  {
                    value: "suggest" as const,
                    label: t("setup.modeSuggest"),
                    desc: t("setup.modeSuggestDesc"),
                  },
                  {
                    value: "auto" as const,
                    label: t("setup.modeAuto"),
                    desc: t("setup.modeAutoDesc"),
                  },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    autoTrackMode === opt.value
                      ? "border-brand-500 bg-brand-50 dark:border-brand-600 dark:bg-tt-gran-lys"
                      : "border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-750"
                  }`}
                >
                  <input
                    type="radio"
                    name="autotrack"
                    checked={autoTrackMode === opt.value}
                    onChange={() => setAutoTrackMode(opt.value)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {opt.label}
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {opt.desc}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        {step === "done" && (
          <div className="text-center py-4">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/50">
              <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              {t("setup.doneTitle")}
            </h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {syncMutation.isPending
                ? t("setup.syncing")
                : syncMutation.data?.success
                  ? t("setup.synced", { count: syncMutation.data.synced ?? 0 })
                  : t("setup.settingsSaved")}
            </p>
            {syncMutation.isPending && (
              <Loader2 className="mx-auto mt-3 h-5 w-5 animate-spin text-brand-500 dark:text-brand-400" />
            )}
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between">
          {currentStepIndex > 0 && step !== "done" ? (
            <button
              type="button"
              onClick={() => setStep(STEPS[currentStepIndex - 1])}
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("setup.back")}
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {step === "done" ? t("setup.goToCalendar") : t("setup.next")}
            {step !== "done" && <ArrowRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
