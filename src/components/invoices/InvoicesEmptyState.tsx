"use client";

import { Building2, Clock, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { formatDuration } from "@/lib/format";

/**
 * Den tomme fakturaliste. En ny bruger har typisk registreret tid, før den
 * første faktura, og den nemme vej er at fakturere den tid. Før stod der kun
 * "Opret første faktura", der åbner en blank formular med beløbsfelt, mens
 * "Fra tidsregistreringer" var en sekundær knap øverst (gennemgang af første
 * oplevelse, 2026-11-22).
 *
 * - Filtreret liste: som før, ingen knap.
 * - Ufaktureret tid: "Fakturér ufaktureret tid" først, blank faktura som
 *   sekundær vej.
 * - Ingen tid endnu: "Registrér tid" først, faktura med fast beløb som
 *   sekundær vej.
 * - Ufaktureret tid, men ingen virksomhedsoplysninger: dem først, for den
 *   første faktura kræver dem (invoices.create afviser altid, og
 *   generateFromTimeEntries afviser, når web sender requireCompanyProfile).
 * - Kunne tallet ikke hentes: "Opret første faktura" som før, så listen
 *   aldrig står uden en handling.
 */
export function InvoicesEmptyState({
  filtered,
  canInvoice,
  unbilledHours,
  unbilledFailed = false,
  missingCompanyProfile = false,
  onInvoiceUnbilled,
}: {
  filtered: boolean;
  canInvoice: boolean;
  /** Ufakturerede timer; undefined mens tallet hentes. */
  unbilledHours: number | undefined;
  /** Opslaget af ufaktureret tid fejlede. */
  unbilledFailed?: boolean;
  /** Ingen virksomhedsprofil endnu (kræves ved første faktura). */
  missingCompanyProfile?: boolean;
  onInvoiceUnbilled: () => void;
}) {
  const t = useTranslations("invoices");
  const tHome = useTranslations("home");

  if (filtered) {
    return (
      <EmptyBox
        title={t("list.emptyFiltered")}
        hint={t("list.emptyFilteredHint")}
      />
    );
  }
  if (!canInvoice) {
    return (
      <EmptyBox title={t("list.emptyNone")} hint={t("list.emptyNoneHint")} />
    );
  }
  // Fejlede opslaget, så den gamle, altid gyldige vej.
  if (unbilledFailed) {
    return (
      <EmptyBox title={t("list.emptyNone")} hint={t("list.emptyNoneHint")}>
        <Link href="/dashboard/invoices/new" className="mt-5 inline-block">
          <Button leftIcon={<Plus className="h-4 w-4" />}>
            {t("list.createFirst")}
          </Button>
        </Link>
      </EmptyBox>
    );
  }
  // Mens tallet hentes: ingen knap, der kan være forkert.
  if (unbilledHours === undefined) {
    return (
      <EmptyBox title={t("list.emptyNone")} hint={t("list.emptyNoneHint")} />
    );
  }

  const hasUnbilled = unbilledHours > 0;
  const duration = formatDuration(unbilledHours, {
    h: tHome("duration.hourUnit"),
    min: tHome("duration.minUnit"),
  });

  if (hasUnbilled && missingCompanyProfile) {
    return (
      <EmptyBox
        title={t("list.emptyNone")}
        hint={t("list.emptyUnbilledHint", { duration })}
      >
        <p className="mx-auto mt-3 max-w-md text-xs font-medium text-gray-700 dark:text-gray-300">
          {t("new.companyTitle")}
        </p>
        <Link
          href="/dashboard/settings/company?from=invoices"
          className="mt-4 inline-block"
        >
          <Button leftIcon={<Building2 className="h-4 w-4" />}>
            {t("new.companyCta")}
          </Button>
        </Link>
      </EmptyBox>
    );
  }

  return (
    <EmptyBox
      title={t("list.emptyNone")}
      hint={
        hasUnbilled
          ? t("list.emptyUnbilledHint", { duration })
          : t("list.emptyNoTimeHint")
      }
    >
      <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
        {hasUnbilled ? (
          <>
            <Button
              leftIcon={<Clock className="h-4 w-4" />}
              onClick={onInvoiceUnbilled}
            >
              {t("list.invoiceUnbilled")}
            </Button>
            <Link href="/dashboard/invoices/new">
              <Button variant="ghost" leftIcon={<Plus className="h-4 w-4" />}>
                {t("list.createBlank")}
              </Button>
            </Link>
          </>
        ) : (
          <>
            <Link href="/dashboard/time/new">
              <Button leftIcon={<Clock className="h-4 w-4" />}>
                {t("list.registerTimeFirst")}
              </Button>
            </Link>
            <Link href="/dashboard/invoices/new">
              <Button variant="ghost" leftIcon={<Plus className="h-4 w-4" />}>
                {t("list.createFixedAmount")}
              </Button>
            </Link>
          </>
        )}
      </div>
    </EmptyBox>
  );
}

function EmptyBox({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-12 text-center">
      <FileText className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" />
      <h3 className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
        {title}
      </h3>
      <p className="mx-auto mt-1 max-w-md text-xs text-gray-500 dark:text-gray-400">
        {hint}
      </p>
      {children}
    </div>
  );
}
