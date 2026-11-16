"use client";

import { format } from "date-fns";
import { da, de, enGB, es } from "date-fns/locale";
import { ArrowRight, CreditCard, Crown, Shield } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import type { OnboardingPlanTier } from "@/lib/billing/signup-plan";
import { planNameForTier, totalPriceForTierSeats } from "@/lib/config";
import { kr } from "@/lib/marketing/pricing-copy";
import { trpc } from "@/providers/trpc-provider";

const DATE_LOCALES = { da, en: enGB, de, es } as const;

interface PaymentStepProps {
  onNext: () => void;
  onSkip: () => void;
  onBack?: () => void;
  subscriptionData?: {
    billingCycle: "monthly" | "yearly";
    planTier?: OnboardingPlanTier;
    seatCount?: number;
    trialEndsAt?: Date;
    promoCode?: string;
  };
}

export function PaymentStep({
  onSkip,
  onBack,
  subscriptionData,
}: PaymentStepProps) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("onboarding.payment");
  const locale = useLocale();
  const [isLoading, setIsLoading] = useState(false);

  const createCheckoutMutation =
    trpc.subscription.createCheckoutSession.useMutation();

  const { data: myTier } = trpc.foundingTier.getMyTier.useQuery();

  const trialEndDate = subscriptionData?.trialEndsAt
    ? format(new Date(subscriptionData.trialEndsAt), "PPP", {
        locale: DATE_LOCALES[locale as keyof typeof DATE_LOCALES] ?? da,
      })
    : null;

  const planTier = subscriptionData?.planTier ?? "solo";
  const isTeam = planTier === "team" || planTier === "business";
  const planLabel = planNameForTier(planTier);
  const billingCycle =
    subscriptionData?.billingCycle === "yearly" ? "yearly" : "monthly";
  const seatCount = subscriptionData?.seatCount ?? 1;

  // Total price (base + extra seats). Founding discount applies to solo only.
  const discountPct = isTeam ? 0 : (myTier?.discountPercent ?? 0);
  const basePrice = totalPriceForTierSeats(planTier, billingCycle, seatCount);
  const actualPrice =
    discountPct > 0
      ? Math.round(basePrice * (1 - discountPct / 100))
      : basePrice;
  const unit = billingCycle === "yearly" ? t("unitYear") : t("unitMonth");

  const handleAddPayment = async () => {
    setIsLoading(true);
    try {
      const appUrl = window.location.origin;
      const result = await createCheckoutMutation.mutateAsync({
        billingCycle: subscriptionData?.billingCycle,
        planTier: subscriptionData?.planTier,
        seatCount: subscriptionData?.seatCount,
        successUrl: `${appUrl}/dashboard?step=complete&payment=success`,
        cancelUrl: `${appUrl}/dashboard?step=payment&payment=canceled`,
      });

      if (result.url) {
        window.location.href = result.url;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("checkoutFailed"));
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-100">
          <CreditCard className="h-8 w-8 text-brand-600 dark:text-brand-400" />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-gray-900">{t("title")}</h2>
        <p className="mt-2 text-gray-600">{t("subtitle")}</p>
      </div>

      {/* Founding member badge */}
      {!isTeam && myTier && (
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

      {/* Plan summary */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">{t("plan")}</span>
            <span className="font-medium text-gray-900">
              {t("planLine", {
                plan: planLabel,
                cycle:
                  billingCycle === "yearly"
                    ? t("cycleYearly")
                    : t("cycleMonthly"),
              })}
              {isTeam ? ` · ${t("seats", { count: seatCount })}` : ""}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">{t("price")}</span>
            <span className="font-medium text-gray-900">
              {t("priceExVat", { price: kr(actualPrice), unit })}
              {discountPct > 0 && (
                <span className="ml-2 text-gray-400 line-through">
                  {kr(basePrice)}
                  {unit}
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">{t("trial")}</span>
            <span className="font-semibold text-green-600">
              {t("freeUntil", { date: trialEndDate || t("trialExpires") })}
            </span>
          </div>
          {trialEndDate && (
            <div className="flex items-center justify-between border-t border-gray-200 pt-3">
              <span className="text-gray-600">{t("paymentStarts")}</span>
              <span className="font-medium text-gray-900">{trialEndDate}</span>
            </div>
          )}
        </div>
      </div>

      {/* Discount note for founding members */}
      {discountPct > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <Crown className="h-5 w-5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            {t.rich("discountNote", {
              percent: discountPct,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>
      )}

      {/* Security note */}
      <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
        <Shield className="h-5 w-5 shrink-0 text-green-600" />
        <p className="text-sm text-green-800">
          {t("security", { brand: brand.name })}
        </p>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={handleAddPayment}
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-tt-gran px-6 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              {t("redirecting")}
            </>
          ) : (
            <>
              <CreditCard className="h-5 w-5" />
              {t("addMethod")}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onSkip}
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          {t("later")}
        </button>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="w-full text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            {t("back")}
          </button>
        )}
      </div>
    </div>
  );
}
