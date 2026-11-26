"use client";

import { Building2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";

/**
 * Genkender fejlen fra generateFromTimeEntries, når den første faktura mangler
 * virksomhedsoplysninger (`data.appCode`, sprogneutral: beskeden er oversat).
 */
export function isCompanyProfileRequiredError(error: unknown): boolean {
  const data = (error as { data?: { appCode?: unknown } | null } | null)?.data;
  return data?.appCode === "COMPANY_PROFILE_REQUIRED";
}

/**
 * Den første faktura kræver virksomhedsoplysningerne (#91). Samme link og vej
 * tilbage som den tomme fakturaliste.
 */
export function CompanyProfileRequired() {
  const t = useTranslations("invoices");
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 rounded-full bg-brand-100 p-4 dark:bg-tt-gran-lys">
        <Building2 className="h-8 w-8 text-brand-600 dark:text-brand-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
        {t("new.companyTitle")}
      </h3>
      <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
        {t("new.companyBody")}
      </p>
      <Link
        href="/dashboard/settings/company?from=invoices"
        className="mt-5 inline-block"
      >
        <Button leftIcon={<Building2 className="h-4 w-4" />}>
          {t("new.companyCta")}
        </Button>
      </Link>
    </div>
  );
}
