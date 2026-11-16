"use client";

import { AlertTriangle, ExternalLink, Smartphone } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useBrand } from "@/components/BrandContext";
import { toIntlLocale } from "@/i18n/format-locale";
import { storeProviderLabel } from "@/lib/store-billing/products";

interface StoreSubscriptionCardProps {
  details: {
    planName: string;
    billingCycle: string;
    storeProvider: string | null;
    storeStatus: string | null;
    storeManageUrl: string | null;
    currentPeriodEnd: Date | string | null;
    cancelAtPeriodEnd: boolean | null;
  };
}

/**
 * Abonnement købt i appen (App Store / Google Play). Butikken fakturerer, så
 * web viser ingen Alunta-knapper: plan, periode og et link til butikkens
 * abonnementsside, hvor brugeren ændrer eller opsiger.
 */
export function StoreSubscriptionCard({ details }: StoreSubscriptionCardProps) {
  const t = useTranslations("billing.subscription.store");
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const intlLocale = toIntlLocale(useLocale());
  const store = storeProviderLabel(details.storeProvider);
  const periodEnd = details.currentPeriodEnd
    ? new Date(details.currentPeriodEnd).toLocaleDateString(intlLocale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;
  const paymentProblem =
    details.storeStatus === "grace_period" ||
    details.storeStatus === "billing_retry";
  const badge =
    details.storeStatus === "paused"
      ? {
          label: t("paused"),
          color:
            "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
        }
      : paymentProblem
        ? {
            label: t("paymentMissing"),
            color:
              "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
          }
        : {
            label: t("active"),
            color:
              "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
          };

  return (
    <div className="space-y-4">
      {paymentProblem && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
          <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
          <p className="text-sm text-yellow-800 dark:text-yellow-300">
            {details.storeStatus === "billing_retry"
              ? t("paymentFailedRetry", { store })
              : t("paymentFailedGrace", { store })}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
          {t("currentPlan")}
        </h2>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">
              {details.planName}
            </h3>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.color}`}
            >
              {badge.label}
            </span>
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
              {details.billingCycle === "yearly" ? t("yearly") : t("monthly")}
            </span>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
            <Smartphone className="h-4 w-4" />
            {t("boughtVia", { store })}
          </p>
          {/* På pause er periodeslut ikke en kommende fornyelse. */}
          {periodEnd && details.storeStatus !== "paused" && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {details.cancelAtPeriodEnd
                ? t("expires", { date: periodEnd })
                : t("renews", { date: periodEnd })}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
          {t("paymentTitle")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t("paymentInfo", { store, brand: brand.name })}
        </p>
        {details.storeManageUrl && (
          <a
            href={details.storeManageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
          >
            {t("manage", { store })}
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
}
