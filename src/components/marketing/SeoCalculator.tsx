"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import {
  type Calculation,
  calculations,
} from "@/lib/marketing/seo-calculations";
import type { ToolField, ToolResult } from "@/lib/marketing/seo-tools";
import { mk } from "./mk";

export function SeoCalculator({
  calculation,
  fields,
  results,
}: {
  calculation: Calculation;
  fields: ToolField[];
  results: ToolResult[];
}) {
  const t = useTranslations("forms.calculator");
  const locale = useLocale();
  const format = useFormatter();
  const formatAmount = (value: number) =>
    format.number(value, { maximumFractionDigits: 2 });
  const inputId = useId();
  const [values, setValues] = useState<(number | null)[]>(() =>
    fields.map((field) => field.initial),
  );
  const amounts = values.every((value) => value !== null)
    ? calculations[calculation](values)
    : null;

  return (
    <div
      className={`${mk.card} grid max-w-4xl gap-6 p-4 sm:p-8 md:grid-cols-2`}
    >
      <div className="grid gap-4">
        {fields.map(
          ({ label, initial, min = 0, max = 1_000_000, whole }, index) => (
            <div key={label} className="grid content-start gap-2">
              <label className="font-medium" htmlFor={`${inputId}-${index}`}>
                {t(`labels.${label}`)}
              </label>
              <input
                id={`${inputId}-${index}`}
                defaultValue={initial}
                type="number"
                lang={locale}
                min={min}
                max={max}
                step={whole ? 1 : "any"}
                required
                aria-invalid={values[index] === null}
                aria-describedby={
                  values[index] === null
                    ? `${inputId}-${index}-error`
                    : undefined
                }
                className="min-h-11 w-full rounded-lg border border-tt-kant bg-tt-papir px-3 text-base tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tt-fokus aria-invalid:border-red-700"
                onChange={({ currentTarget }) => {
                  const value = currentTarget.validity.valid
                    ? currentTarget.valueAsNumber
                    : null;
                  setValues((previous) =>
                    previous.map((entry, position) =>
                      position === index ? value : entry,
                    ),
                  );
                }}
              />
              {values[index] === null && (
                <p className={mk.fine} id={`${inputId}-${index}-error`}>
                  {t(whole ? "wholeOutOfRange" : "outOfRange", {
                    min: formatAmount(min),
                    max: formatAmount(max),
                  })}
                </p>
              )}
            </div>
          ),
        )}
      </div>
      <div
        aria-live="polite"
        aria-atomic="true"
        className="rounded-[14px] bg-tt-flade p-4 sm:p-6"
      >
        <dl className="grid gap-4">
          {results.map(({ label, unit }, index) => {
            const amount = amounts?.[index];
            return (
              <div key={label}>
                <dt className={mk.fine}>{t(`labels.${label}`)}</dt>
                <dd className="mt-1 text-xl font-bold tabular-nums">
                  {amount == null
                    ? t("pending")
                    : `${formatAmount(amount)} ${t(`units.${unit}`)}`}
                </dd>
              </div>
            );
          })}
        </dl>
        {amounts?.includes(null) && (
          <p className={`${mk.fine} mt-4`}>{t("missingHours")}</p>
        )}
      </div>
    </div>
  );
}
