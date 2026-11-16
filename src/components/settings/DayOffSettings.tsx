"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { trpc } from "@/providers/trpc-provider";
import { DayOffCalendarEditor } from "./DayOffCalendarEditor";

/**
 * Personlige fridage (#526). Har organisationen eller afdelingen valgt en
 * fridagskalender, gælder den — og den egne kalender vises ikke. Det samme
 * gælder medarbejdere med HR-normtid (#742): de følger org'ens fridage
 * (eller standarden, til org'en vælger), aldrig en egen kalender.
 */
export function DayOffSettings() {
  const t = useTranslations("settingsSchedule.dayOff");
  const { data } = trpc.dayOff.getEffective.useQuery();
  if (!data) return null;

  if (data.personalBlockedBy === "employee") {
    return (
      <section className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("title")}
        </h2>
        <p className="mt-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-900 dark:bg-tt-gran-lys dark:text-brand-200">
          {t("employeeFollows")}
        </p>
      </section>
    );
  }

  if (data.source === "org" || data.source === "department") {
    return (
      <section className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t("title")}
        </h2>
        <p className="mt-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-900 dark:bg-tt-gran-lys dark:text-brand-200">
          {t.rich("chosenByOrg", {
            source:
              data.source === "department" ? t("sourceDept") : t("sourceOrg"),
            preset: t(
              data.preset === "private" ? "presetPrivate" : "presetOk24",
            ),
            link: (chunks) => (
              <Link
                href="/dashboard/settings/company#fridage"
                className="font-medium underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </section>
    );
  }

  return (
    <DayOffCalendarEditor
      scope={{ scope: "user" }}
      title={t("title")}
      description={t("description")}
    />
  );
}
