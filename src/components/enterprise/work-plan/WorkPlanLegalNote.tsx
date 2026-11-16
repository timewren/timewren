import { Scale } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Juridisk hjælpetekst (#510). Lovteksten er ordret fra arbejdstidsloven
 * (LBK nr. 982 af 12/08/2024) § 4 b, stk. 1-3, tjekket mod
 * retsinformation.dk 2. oktober 2026. Adgangen til kun at registrere
 * afvigelser står ikke i selve paragraffen, men i lovforslagets
 * forarbejder (L 68, folketingsåret 2023-24) og Beskæftigelsesministeriets
 * svar — derfor formuleret som "ifølge forarbejderne". Opdatér datoen
 * (legal.verified i enterpriseComponents), hvis teksten tjekkes igen.
 * Teksten på andre sprog er uofficielle oversættelser og skal læses af et menneske.
 */
export function WorkPlanLegalNote({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("enterpriseComponents.workPlan.legal");
  return (
    <details className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900/60 dark:text-gray-300">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-gray-900 dark:text-gray-100">
        <Scale className="h-4 w-4 shrink-0" aria-hidden />
        {t("summary")}
      </summary>
      <div className="mt-3 space-y-3 leading-relaxed">
        <p>{t("intro")}</p>
        {!compact && (
          <>
            <blockquote className="border-l-2 border-gray-300 pl-3 text-gray-600 dark:border-gray-700 dark:text-gray-400">
              <p>{t("quote1")}</p>
              <p className="mt-2">{t("quote2")}</p>
              <p className="mt-2">{t("quote3")}</p>
            </blockquote>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t("point1")}</li>
              <li>{t("point2")}</li>
              <li>{t("point3")}</li>
            </ul>
          </>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("source", { date: t("verified") })}
        </p>
      </div>
    </details>
  );
}
