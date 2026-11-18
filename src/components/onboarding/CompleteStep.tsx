"use client";

import { format } from "date-fns";
import { da, de, enGB, es } from "date-fns/locale";
import {
  ArrowRight,
  ChartBar,
  Check,
  Clock,
  CreditCard,
  Crown,
  HelpCircle,
  Play,
  Ticket,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { supportEmailOf, useBrand } from "@/components/BrandContext";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import type { OnboardingPlanTier } from "@/lib/billing/signup-plan";
import {
  includedSeatsForTier,
  type PlanTier,
  totalPriceForTierSeats,
} from "@/lib/config";
import { kr } from "@/lib/marketing/pricing-copy";
import { trpc } from "@/providers/trpc-provider";

const DATE_LOCALES = { da, en: enGB, de, es } as const;

interface CompleteStepProps {
  onFinish: () => void;
  subscriptionData?: {
    billingCycle: "monthly" | "yearly";
    planTier?: OnboardingPlanTier;
    seatCount?: number;
    trialEndsAt?: Date;
    promoCode?: string;
  };
  companyData?: {
    name: string;
  };
  importData?: {
    clientsImported?: number;
    projectsImported?: number;
  };
  aiSetupData?: {
    aiAutonomyLevel: string;
    emailEnabled: boolean;
    calendarConnected: boolean;
  };
  hasPaymentMethod?: boolean;
}

export function CompleteStep({
  onFinish,
  subscriptionData,
  companyData,
  importData,
  aiSetupData,
  hasPaymentMethod,
}: CompleteStepProps) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("onboarding.complete");
  const locale = useLocale();
  // TimeWren: ingen TimeTrack-planpris (DKK), prøve eller betalingspåmindelse;
  // TimeWren Cloud viser planerne i EUR på abonnementssiden.
  const { enabled, checkoutAvailable, provider } = useBillingEnabled();
  const billingEnabled = enabled && checkoutAvailable && provider !== "stripe";
  const { data: myTier } = trpc.foundingTier.getMyTier.useQuery();

  const trialEndDate = subscriptionData?.trialEndsAt
    ? format(new Date(subscriptionData.trialEndsAt), "PPP", {
        locale: DATE_LOCALES[locale as keyof typeof DATE_LOCALES] ?? da,
      })
    : null;

  // Tier + seat-aware price (base + extra seats), so a team/business onboarder
  // doesn't see the solo 99/990 figure on the final screen.
  const billingCycle =
    subscriptionData?.billingCycle === "yearly" ? "yearly" : "monthly";
  const tier: PlanTier = subscriptionData?.planTier ?? "solo";
  const seatCount = subscriptionData?.seatCount ?? includedSeatsForTier(tier);
  const basePrice = totalPriceForTierSeats(tier, billingCycle, seatCount);
  // Founding member discount only applies to the solo plan.
  const discountPct = tier === "solo" ? (myTier?.discountPercent ?? 0) : 0;
  const actualPrice =
    discountPct > 0
      ? Math.round(basePrice * (1 - discountPct / 100))
      : basePrice;
  const unit = billingCycle === "yearly" ? t("unitYear") : t("unitMonth");

  return (
    <div className="space-y-6 text-center">
      {/* Success Hero */}
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
        <Check className="h-10 w-10 text-green-600" />
      </div>

      <div>
        <h2 className="text-3xl font-bold text-gray-900">
          {t("title", { brand: brand.name })}
        </h2>
        <p className="mt-2 text-lg text-gray-600">{t("subtitle")}</p>
      </div>

      {/* Founding member badge — the founding discount only applies to solo. */}
      {billingEnabled && myTier && tier === "solo" && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <Crown className="h-5 w-5 text-amber-600" />
          <span className="font-semibold text-amber-900">
            {t("founding", {
              label: myTier.label,
              percent: myTier.discountPercent,
            })}
          </span>
        </div>
      )}

      {/* Account Summary */}
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 text-left">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          {t("account")}
        </h3>

        <div className="space-y-3 text-sm">
          {billingEnabled && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">{t("plan")}</span>
                <span className="font-medium text-gray-900">
                  {subscriptionData?.billingCycle === "yearly"
                    ? t("cycleYearly")
                    : t("cycleMonthly")}
                  {", "}
                  {t("priceExVat", { price: kr(actualPrice), unit })}
                  {discountPct > 0 && (
                    <span className="ml-1 text-gray-400 line-through">
                      {kr(basePrice)}
                      {unit}
                    </span>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-600">{t("status")}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                  <Sparkles className="h-3 w-3" />
                  {t("trial")}
                </span>
              </div>

              {trialEndDate && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">{t("freeUntil")}</span>
                  <span className="font-medium text-gray-900">
                    {trialEndDate}
                  </span>
                </div>
              )}
            </>
          )}

          {companyData?.name && (
            <div className="flex items-center justify-between border-t border-gray-100 pt-3">
              <span className="text-gray-600">{t("company")}</span>
              <span className="font-medium text-gray-900">
                {companyData.name}
              </span>
            </div>
          )}

          {importData && (
            <>
              {importData.clientsImported !== undefined &&
                importData.clientsImported > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">{t("clients")}</span>
                    <span className="font-medium text-gray-900">
                      {t("imported", { count: importData.clientsImported })}
                    </span>
                  </div>
                )}

              {importData.projectsImported !== undefined &&
                importData.projectsImported > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">{t("projects")}</span>
                    <span className="font-medium text-gray-900">
                      {t("imported", { count: importData.projectsImported })}
                    </span>
                  </div>
                )}
            </>
          )}

          {aiSetupData && (
            <div className="space-y-3 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">{t("aiLevel")}</span>
                <span className="font-medium text-gray-900">
                  {aiSetupData.aiAutonomyLevel === "suggest"
                    ? t("aiSuggest")
                    : aiSetupData.aiAutonomyLevel === "auto_lowrisk"
                      ? t("aiAuto")
                      : t("aiManual")}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">{t("emailToTask")}</span>
                <span
                  className={`font-medium ${aiSetupData.emailEnabled ? "text-green-600" : "text-gray-500"}`}
                >
                  {aiSetupData.emailEnabled ? t("enabled") : t("notEnabled")}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Payment Reminder — only shown if user skipped payment step */}
      {billingEnabled && !hasPaymentMethod && (
        <PaymentReminder
          billingCycle={subscriptionData?.billingCycle}
          trialEndDate={trialEndDate}
        />
      )}

      {/* Quick Actions */}
      <div className="text-left">
        <h3 className="mb-4 text-lg font-semibold text-gray-900">
          {t("getStarted")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <a
            href="/dashboard/time"
            className="group flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 transition-all hover:border-brand-500 dark:hover:border-brand-600"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 transition-colors group-hover:bg-brand-200">
              <Clock className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-gray-900">{t("firstHour")}</div>
              <div className="text-xs text-gray-600">{t("startTracking")}</div>
            </div>
          </a>

          <a
            href="/dashboard/klippekort/new"
            className="group flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 transition-all hover:border-brand-500 dark:hover:border-brand-600"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-100 transition-colors group-hover:bg-brand-200">
              <Ticket className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-gray-900">
                {t("createPrepaid")}
              </div>
              <div className="text-xs text-gray-600">{t("prepaidDesc")}</div>
            </div>
          </a>

          <a
            href="/dashboard/reports"
            className="group flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 transition-all hover:border-brand-500 dark:hover:border-brand-600"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-100 transition-colors group-hover:bg-green-200">
              <ChartBar className="h-5 w-5 text-green-600" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-gray-900">{t("seeReports")}</div>
              <div className="text-xs text-gray-600">{t("reportsDesc")}</div>
            </div>
          </a>
        </div>
      </div>

      {/* Resources */}
      <div className="rounded-lg bg-gray-50 p-6 text-left">
        <h4 className="mb-3 font-semibold text-gray-900">{t("resources")}</h4>
        <div className="space-y-2 text-sm">
          <a
            href="/dashboard/help"
            className="flex items-center gap-2 text-gray-700 hover:text-brand-600 dark:hover:text-brand-300"
          >
            <HelpCircle className="h-4 w-4" />
            <span>{t("helpDocs")}</span>
          </a>
          <a
            href={`mailto:${supportEmailOf(brand)}`}
            className="flex items-center gap-2 text-gray-700 hover:text-brand-600 dark:hover:text-brand-300"
          >
            <Mail className="h-4 w-4" />
            <span>{t("writeSupport")}</span>
          </a>
        </div>
      </div>

      {/* Finish Button */}
      <button
        type="button"
        onClick={onFinish}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-tt-gran px-6 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
      >
        <Play className="h-5 w-5" />
        {t("goDashboard")}
      </button>
    </div>
  );
}

function PaymentReminder({
  billingCycle,
  trialEndDate,
}: {
  billingCycle?: "monthly" | "yearly";
  trialEndDate: string | null;
}) {
  const t = useTranslations("onboarding.complete");
  const createCheckout = trpc.subscription.createCheckoutSession.useMutation();
  const [isLoading, setIsLoading] = useState(false);

  const handleAddPayment = async () => {
    setIsLoading(true);
    try {
      const appUrl = window.location.origin;
      const result = await createCheckout.mutateAsync({
        billingCycle,
        successUrl: `${appUrl}/dashboard?payment=success`,
        cancelUrl: `${appUrl}/dashboard?payment=canceled`,
      });
      if (result.url) {
        window.location.href = result.url;
      }
    } catch {
      toast.error(t("checkoutFailed"));
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-6 text-left">
      <div className="flex items-start gap-3">
        <CreditCard className="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" />
        <div className="flex-1">
          <h4 className="font-semibold text-brand-900 dark:text-brand-400">
            {t("addPaymentMethod")}
          </h4>
          <p className="mt-1 text-sm text-brand-800 dark:text-brand-400">
            {trialEndDate
              ? t("addPaymentBeforeOn", { date: trialEndDate })
              : t("addPaymentBefore")}
          </p>
          <button
            type="button"
            onClick={handleAddPayment}
            disabled={isLoading}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {t("redirecting")}
              </>
            ) : (
              <>
                {t("addNow")}
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Sparkles({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
      />
    </svg>
  );
}

function Mail({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}
