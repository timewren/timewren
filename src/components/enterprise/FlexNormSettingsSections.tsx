"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import {
  FLEX_NORM_PRESET_DEFS,
  FLEX_NORM_PRESETS,
  type FlexNormPreset,
  NORM_PERIODS,
  NORM_YEAR_STARTS,
  type NormPeriod,
  type NormYearStart,
} from "@/lib/enterprise/norm-period";
import {
  PERIOD_CLOSING_INTERVALS,
  PERIOD_CLOSING_PRESET,
  type PeriodClosingInterval,
} from "@/lib/enterprise/period-closing";
import { trpc } from "@/providers/trpc-provider";

type OrgRow = {
  flexNormPeriod: string;
  flexNormYearStart: string;
  flexNormAnnualHours: string | null;
  flexCarryoverMaxHours: string | null;
  flexCarryoverMaxDeficitHours: string | null;
  flexNormStartDate: string | null;
  periodClosingInterval: string | null;
} | null;

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800"
    >
      <h3
        id={id}
        className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function toInput(v: string | null | undefined): string {
  return v == null ? "" : String(Number(v)).replace(".", ",");
}

/** "" → null, ellers tal (komma accepteres); NaN ved ugyldigt input. */
function parseOptional(raw: string): number | null {
  const v = raw.trim().replace(",", ".");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

const hintClass = "mt-1 text-xs text-gray-500 dark:text-gray-400";

/** Normperiode og flex (#507). */
export function FlexNormSettingsSection({
  org,
  inputClass,
  labelClass,
}: {
  org: OrgRow;
  inputClass: string;
  labelClass: string;
}) {
  const t = useTranslations("enterpriseSettings.flexNorm");
  const tc = useTranslations("enterpriseCommon");
  const utils = trpc.useUtils();
  const [period, setPeriod] = useState<NormPeriod>("week");
  const [yearStart, setYearStart] = useState<NormYearStart>("calendar");
  const [annualHours, setAnnualHours] = useState("");
  const [carryMax, setCarryMax] = useState("");
  const [carryDeficit, setCarryDeficit] = useState("");
  const [startDate, setStartDate] = useState("");

  useEffect(() => {
    if (!org) return;
    setPeriod(
      (NORM_PERIODS as readonly string[]).includes(org.flexNormPeriod)
        ? (org.flexNormPeriod as NormPeriod)
        : "week",
    );
    setYearStart(org.flexNormYearStart === "school" ? "school" : "calendar");
    setAnnualHours(toInput(org.flexNormAnnualHours));
    setCarryMax(toInput(org.flexCarryoverMaxHours));
    setCarryDeficit(toInput(org.flexCarryoverMaxDeficitHours));
    setStartDate(org.flexNormStartDate ?? "");
  }, [org]);

  const mutation = trpc.enterprise.updateFlexNormSettings.useMutation({
    onSuccess: () => {
      utils.enterprise.get.invalidate();
      utils.enterprise.getFlexNormSettings.invalidate();
      utils.enterprise.getFlexNormBalance.invalidate();
      utils.enterprise.getTeamFlexNormBalances.invalidate();
      toast.success(t("saved"));
    },
    onError: (e) => toast.error(e.message || t("saveFailed")),
  });

  const applyPreset = (preset: FlexNormPreset) => {
    const s = FLEX_NORM_PRESET_DEFS[preset].settings;
    setPeriod(s.period);
    setYearStart(s.yearStart);
    setAnnualHours(s.annualHours == null ? "" : String(s.annualHours));
  };

  const save = () => {
    const annual = parseOptional(annualHours);
    const max = parseOptional(carryMax);
    const deficit = parseOptional(carryDeficit);
    if (
      annual !== null &&
      (Number.isNaN(annual) || annual < 1 || annual > 4000)
    ) {
      toast.error(t("annualRange"));
      return;
    }
    for (const [v, label] of [
      [max, t("capPlus")],
      [deficit, t("capMinus")],
    ] as const) {
      if (v !== null && (Number.isNaN(v) || v < 0 || v > 2000)) {
        toast.error(t("capRange", { label }));
        return;
      }
    }
    mutation.mutate({
      period,
      yearStart,
      annualHours: annual,
      carryoverMaxHours: max,
      carryoverMaxDeficitHours: deficit,
      startDate: startDate.trim() === "" ? null : startDate,
    });
  };

  return (
    <Section title={t("title")} id="flex-norm-settings">
      <div className="space-y-4">
        <div>
          <p className={labelClass}>{t("presets")}</p>
          <div className="flex flex-wrap gap-2">
            {FLEX_NORM_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applyPreset(p)}
                title={t(
                  p === "standard"
                    ? "presetStandardDesc"
                    : "presetTeachersDesc",
                )}
                className="min-h-[36px] rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
              >
                {t(
                  p === "standard"
                    ? "presetStandardLabel"
                    : "presetTeachersLabel",
                )}
              </button>
            ))}
          </div>
          <p className={hintClass}>{t("presetHint")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="flex-period">
              {t("period")}
            </label>
            <select
              id="flex-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as NormPeriod)}
              className={inputClass}
            >
              {NORM_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {tc(`normPeriod.${p}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="flex-year-start">
              {t("year")}
            </label>
            <select
              id="flex-year-start"
              value={yearStart}
              onChange={(e) => setYearStart(e.target.value as NormYearStart)}
              className={inputClass}
              disabled={period === "week" || period === "month"}
            >
              {NORM_YEAR_STARTS.map((y) => (
                <option key={y} value={y}>
                  {tc(`normYear.${y}`)}
                </option>
              ))}
            </select>
            <p className={hintClass}>{t("yearHint")}</p>
          </div>
          <div>
            <label className={labelClass} htmlFor="flex-annual">
              {t("annualHours")}
            </label>
            <input
              id="flex-annual"
              type="text"
              inputMode="decimal"
              value={annualHours}
              onChange={(e) => setAnnualHours(e.target.value)}
              placeholder={t("annualPlaceholder")}
              className={inputClass}
            />
            <p className={hintClass}>{t("annualHint")}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="flex-carry-max">
              {t("carryMax")}
            </label>
            <input
              id="flex-carry-max"
              type="text"
              inputMode="decimal"
              value={carryMax}
              onChange={(e) => setCarryMax(e.target.value)}
              placeholder={t("noCap")}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="flex-carry-deficit">
              {t("carryDeficit")}
            </label>
            <input
              id="flex-carry-deficit"
              type="text"
              inputMode="decimal"
              value={carryDeficit}
              onChange={(e) => setCarryDeficit(e.target.value)}
              placeholder={t("noCap")}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="flex-start">
              {t("startFrom")}
            </label>
            <input
              id="flex-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
            <p className={hintClass}>{t("startHint")}</p>
          </div>
        </div>
        <p className={hintClass}>{t("carryHint")}</p>

        <Button onClick={save} disabled={mutation.isPending}>
          {mutation.isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </Section>
  );
}

/** Periodeafslutning (#518). */
export function PeriodClosingSettingsSection({
  org,
  labelClass,
  inputClass,
}: {
  org: OrgRow;
  inputClass: string;
  labelClass: string;
}) {
  const t = useTranslations("enterpriseSettings.flexNorm");
  const tc = useTranslations("enterpriseCommon");
  const utils = trpc.useUtils();
  const [interval, setClosingInterval] = useState<PeriodClosingInterval | "">(
    "",
  );

  useEffect(() => {
    if (!org) return;
    setClosingInterval(
      (PERIOD_CLOSING_INTERVALS as readonly string[]).includes(
        org.periodClosingInterval ?? "",
      )
        ? (org.periodClosingInterval as PeriodClosingInterval)
        : "",
    );
  }, [org]);

  const mutation = trpc.enterprise.updatePeriodClosingSettings.useMutation({
    onSuccess: () => {
      utils.enterprise.get.invalidate();
      utils.enterprise.listTeamPeriodClosings.invalidate();
      toast.success(t("closing.saved"));
    },
    onError: (e) => toast.error(e.message || t("closing.saveFailed")),
  });

  return (
    <Section title={t("closing.title")} id="period-closing-settings">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("closing.intro")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="closing-interval">
              {t("closing.statement")}
            </label>
            <select
              id="closing-interval"
              value={interval}
              onChange={(e) =>
                setClosingInterval(e.target.value as PeriodClosingInterval | "")
              }
              className={inputClass}
            >
              <option value="">{t("closing.off")}</option>
              {PERIOD_CLOSING_INTERVALS.map((i) => (
                <option key={i} value={i}>
                  {tc(`periodClosing.interval.${i}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setClosingInterval(PERIOD_CLOSING_PRESET.interval)}
              className="min-h-[36px] rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              {t("closing.presetLabel")}
            </button>
          </div>
        </div>
        <Button
          onClick={() =>
            mutation.mutate({ interval: interval === "" ? null : interval })
          }
          disabled={mutation.isPending}
        >
          {mutation.isPending ? t("saving") : t("save")}
        </Button>
      </div>
    </Section>
  );
}
