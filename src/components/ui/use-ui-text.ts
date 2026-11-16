"use client";

import { useLocale } from "next-intl";
import daUi from "@/i18n/messages/da/ui.json";
import { type SafeT, useSafeTranslations } from "./use-safe-translations";

/**
 * Tekster til de delte UI-primitiver (Modal, Badge, LoadingScreen ...).
 * De bruges også på sider uden next-intl-udbyder (fx platformadmin og
 * loginsider); uden udbyder falder hooken tilbage på dansk.
 */
export function useUiText(): SafeT {
  return useSafeTranslations("ui", daUi);
}

/** Som `useUiText`, men med fast nøgleforstavelse (fx "empty.clients"). */
export function useUiScope(
  prefix: string,
): (key: string, values?: Record<string, string | number>) => string {
  const t = useUiText();
  return (key, values) => t(`${prefix}.${key}`, values);
}

/** Aktivt sprog; dansk uden next-intl-udbyder. */
export function useUiLocale(): string {
  try {
    // biome-ignore lint/correctness/useHookAtTopLevel: useLocale kaster uden udbyder; hooks-rækkefølgen er den samme i begge tilfælde
    return useLocale();
  } catch {
    return "da";
  }
}
