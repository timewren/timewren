"use client";

import { createTranslator, useMessages, useTranslations } from "next-intl";
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
 * udbyder, eller med en udbyder uden navneområdet (marketingsiderne har kun
 * "forms"), falder den tilbage på de danske tekster, som `getT` gør uden
 * forespørgselskontekst. Giv kun et enkelt navneområde (uden punktum).
 */
export function useSafeTranslations(
  namespace: string,
  daMessages: Messages,
): SafeT {
  try {
    // biome-ignore lint/correctness/useHookAtTopLevel: useMessages kaster uden udbyder; hooks-rækkefølgen er den samme i begge tilfælde
    const messages = useMessages();
    if (!(namespace in messages)) return fallbackFor(namespace, daMessages);
    // biome-ignore lint/correctness/useHookAtTopLevel: se ovenfor; udbyderen skifter ikke under en rendering
    return useTranslations(namespace) as unknown as SafeT;
  } catch {
    return fallbackFor(namespace, daMessages);
  }
}
