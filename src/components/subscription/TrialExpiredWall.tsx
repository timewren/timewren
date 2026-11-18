"use client";

import {
  Check,
  CreditCard,
  Download,
  ExternalLink,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { BrandLogo as Logo, useBrand } from "@/components/BrandContext";
import { TimewrenBillingPanel } from "@/components/subscription/TimewrenBillingPanel";
import { Button } from "@/components/ui/Button";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { signOut } from "@/lib/auth-client";
import { FREE_MEMBER_LOCKED_MESSAGE } from "@/lib/billing/plan-gate";
import { planNameForTier, totalPriceForTierSeats } from "@/lib/config";
import { kr } from "@/lib/marketing/pricing-copy";
import { trpc } from "@/providers/trpc-provider";

type BillingCycle = "monthly" | "yearly";

interface TrialExpiredWallProps {
  subscription: {
    status: string;
    isTrialExpired: boolean;
    planTier?: string;
    seatCount?: number;
    memberLocked?: boolean;
  } | null;
}

export function TrialExpiredWall({ subscription }: TrialExpiredWallProps) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("billing.subscription.wall");
  const [selectedCycle, setSelectedCycle] = useState<BillingCycle>("yearly");

  const isPastDue = subscription?.status === "past_due";
  // Medlem ud over Gratis-pladserne: kun ejeren kan opgradere, så ingen checkout.
  const isMemberLocked = !!subscription?.memberLocked;
  const planTier = subscription?.planTier ?? "solo";
  const isTeam = planTier === "team" || planTier === "business";
  const planName = planNameForTier(planTier);
  const seatCount = subscription?.seatCount ?? 1;
  // Include per-seat add-ons so the shown price matches what checkout charges.
  const price = totalPriceForTierSeats(planTier, selectedCycle, seatCount);
  const { data: myTier } = trpc.foundingTier.getMyTier.useQuery();

  const createCheckout = trpc.subscription.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast.error(t("checkoutFailed"));
    },
  });

  // TimeWren Cloud betaler med Stripe: kort opdateres i Stripes portal, og
  // planer vælges i TimewrenBillingPanel (EUR), aldrig i Alunta.
  const { provider } = useBillingEnabled();
  const isStripe = provider === "stripe";
  const stripePortal = trpc.timewrenBilling.portal.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: () => {
      toast.error(t("portalFailed"));
    },
  });

  const createPortal = trpc.subscription.createPortalSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      toast.error(t("portalFailed"));
    },
  });

  const heading = !subscription
    ? t("headingNone")
    : isMemberLocked
      ? t("headingLocked")
      : isPastDue
        ? t("headingPastDue")
        : subscription.status === "canceled"
          ? t("headingCanceled")
          : t("headingTrial");

  const subheading = !subscription
    ? t("subNone", { brand: brand.name })
    : isMemberLocked
      ? FREE_MEMBER_LOCKED_MESSAGE
      : isPastDue
        ? t("subPastDue")
        : t("subUpgrade", { plan: planName });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-lg text-center">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          {heading}
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{subheading}</p>

        {/* Låst Gratis-medlem — ejeren skal opgradere; ingen checkout her */}
        {isMemberLocked ? null : isPastDue ? (
          <div className="mt-8">
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20 p-6">
              <p className="text-sm text-yellow-800 dark:text-yellow-300 mb-4">
                {t("pastDueBody", { brand: brand.name })}
              </p>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                isLoading={
                  isStripe ? stripePortal.isPending : createPortal.isPending
                }
                onClick={() =>
                  isStripe ? stripePortal.mutate() : createPortal.mutate()
                }
              >
                <ExternalLink className="h-5 w-5" />
                {t("updatePayment")}
              </Button>
            </div>
          </div>
        ) : isStripe ? (
          <div className="mt-8 text-left">
            <TimewrenBillingPanel />
          </div>
        ) : (
          <>
            {/* Billing cycle toggle */}
            <div className="mt-8 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedCycle("monthly")}
                className={`rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors ${
                  selectedCycle === "monthly"
                    ? "bg-tt-gran text-tt-paa-gran"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                }`}
              >
                {t("monthly")}
              </button>
              <button
                type="button"
                onClick={() => setSelectedCycle("yearly")}
                className={`rounded-lg px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors ${
                  selectedCycle === "yearly"
                    ? "bg-tt-gran text-tt-paa-gran"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                }`}
              >
                {t("yearly")}
                <span className="ml-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  {t("save17")}
                </span>
              </button>
            </div>

            {/* Pricing card */}
            <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <p className="text-sm font-medium text-brand-600 dark:text-brand-400">
                {planName}
              </p>
              <div className="mt-2 flex items-baseline justify-center gap-1">
                <span className="text-4xl font-bold text-gray-900 dark:text-white">
                  {kr(price)}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {selectedCycle === "yearly"
                    ? t("perYearExVat")
                    : t("perMonthExVat")}
                </span>
              </div>
              {selectedCycle === "yearly" && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {t("equivalent", { price: kr(Math.round(price / 12)) })}
                </p>
              )}

              <ul className="mt-6 space-y-3 text-left text-sm text-gray-700 dark:text-gray-300">
                {[
                  ...(isTeam
                    ? [t("featureWorkspace"), t("featureTeamReports")]
                    : []),
                  t("featureUnlimited"),
                  t("featureInvoicing"),
                  t("featureManagement"),
                  t("featureReports"),
                  t("featureIntegrations"),
                ].map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                variant="primary"
                size="lg"
                fullWidth
                className="mt-6"
                isLoading={createCheckout.isPending}
                onClick={() =>
                  createCheckout.mutate({
                    billingCycle: selectedCycle,
                    planTier: planTier as "solo" | "team" | "business",
                    seatCount,
                  })
                }
              >
                <CreditCard className="h-5 w-5" />
                {t("upgradeNow")}
              </Button>
              {myTier && myTier.discountPercent > 0 && (
                <p className="mt-3 text-center text-xs text-amber-600 dark:text-amber-400">
                  {t("discountNote", { percent: myTier.discountPercent })}
                </p>
              )}
            </div>
          </>
        )}

        {/* Utility links */}
        <div className="mt-6 flex flex-col items-center gap-3 text-sm">
          <Link
            href="/dashboard/settings/subscription"
            className="text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            {t("manageAccount")}
          </Link>
          <Link
            href="/dashboard/settings/data"
            className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            <Download className="h-3.5 w-3.5" />
            {t("exportData")}
          </Link>
          <button
            type="button"
            onClick={() =>
              signOut().then(() => window.location.assign("/login"))
            }
            className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t("signOut")}
          </button>
        </div>
      </div>
    </div>
  );
}
