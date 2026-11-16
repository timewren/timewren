"use client";

import { useLocale } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";

/** Tal formateret efter aktivt sprog med et fast antal decimaler. */
export function useNumberFormat(
  minimumFractionDigits: number,
  maximumFractionDigits = minimumFractionDigits,
): (value: number) => string {
  const intl = toIntlLocale(useLocale());
  return (value: number) =>
    value.toLocaleString(intl, {
      minimumFractionDigits,
      maximumFractionDigits,
    });
}
