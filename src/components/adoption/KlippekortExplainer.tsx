"use client";

import { Calculator, Plus, Ticket } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { PrepaidSuggestion } from "./PrepaidSuggestion";

const POINT_KEYS = ["point1", "point2", "point3"] as const;

/**
 * Tom tilstand på klippekort-siden (#90): forklarer modellen kort i stedet
 * for blot "ingen klippekort", viser forslag ud fra brugerens egen tid og
 * linker til prisberegneren.
 */
export function KlippekortExplainer() {
  const t = useTranslations("billing.adoption.explainer");
  return (
    <div className="mx-auto max-w-2xl space-y-5 py-10">
      <div className="text-center">
        <Ticket
          className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600"
          aria-hidden="true"
        />
        <h2 className="mt-3 text-base font-semibold text-gray-900 dark:text-white">
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t("intro")}
        </p>
      </div>

      <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
        {POINT_KEYS.map((point) => (
          <li key={point} className="flex gap-2">
            <span
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400"
              aria-hidden="true"
            />
            {t(point)}
          </li>
        ))}
      </ul>

      <PrepaidSuggestion surface="klippekort_empty" limit={3} />

      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link href="/dashboard/klippekort/new">
          <Button leftIcon={<Plus className="h-4 w-4" />}>{t("create")}</Button>
        </Link>
        <Link
          href="/klippekort-prisberegner"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 underline-offset-2 hover:underline dark:text-gray-400"
        >
          <Calculator className="h-4 w-4" aria-hidden="true" />
          {t("calculator")}
        </Link>
      </div>
    </div>
  );
}
