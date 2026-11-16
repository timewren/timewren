"use client";

import { createTranslator, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { brandize } from "@/i18n/brandize";

type Messages = Record<string, unknown>;
export type SafeT = ((
  key: string,
  values?: Record<string, string | number>,
) => string) & {
  rich: (
    key: string,
    values?: Record<
      string,
      string | number | ((chunks: ReactNode) => ReactNode)
    >,
  ) => ReactNode;
  has: (key: string) => boolean;
};

const fallbackCache = new Map<string, SafeT>();

function fallbackFor(namespace: string, daMessages: Messages): SafeT {
  let t = fallbackCache.get(namespace);
  if (!t) {
    t = createTranslator({
      locale: "da",
      messages: { [namespace]: brandize(daMessages) },
      namespace,
    }) as unknown as SafeT;
    fallbackCache.set(namespace, t);
  }
  return t;
}

/**
 * `useTranslations` for komponenter, der også vises på sider uden
 * next-intl-udbyder (offentlige sider, kundeportal, platformadmin). Uden
 * udbyder falder den tilbage på de danske tekster, som `getT` gør uden
 * forespørgselskontekst. Giv kun et enkelt navneområde (uden punktum).
 */
export function useSafeTranslations(
  namespace: string,
  daMessages: Messages,
): SafeT {
  try {
    // biome-ignore lint/correctness/useHookAtTopLevel: useTranslations kaster uden udbyder; hooks-rækkefølgen er den samme i begge tilfælde
    return useTranslations(namespace) as unknown as SafeT;
  } catch {
    return fallbackFor(namespace, daMessages);
  }
}
