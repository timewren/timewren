"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

/**
 * Klientkomponenternes oversættelser på marketingsiderne (fx tilmeldings- og
 * kontaktformularen). Klientudgaven af provideren bruges med vilje: server-
 * udgaven slår formater, tid og tidszone op i forespørgslen, og så kan
 * siderne ikke længere renderes statisk.
 */
export function MarketingIntlProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Record<string, unknown>;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone="Europe/Copenhagen"
    >
      {children}
    </NextIntlClientProvider>
  );
}
