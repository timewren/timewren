"use client";

import {
  Building2,
  Check,
  House,
  Minus,
  Plus,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useBrand } from "@/components/BrandContext";
import {
  normalizeCampaignCode,
  readCampaignCookie,
} from "@/lib/billing/campaign-codes";
import { PRIVAT_MAX_ACTIVE_CLIENTS } from "@/lib/billing/plan-gate";
import type { OnboardingPlanTier } from "@/lib/billing/signup-plan";
import {
  BUSINESS_INCLUDED_SEATS,
  BUSINESS_MAX_SEATS,
  BUSINESS_SEAT_PRICE_MONTHLY,
  clampSeats,
  includedSeatsForTier,
  planNameForTier,
  seatPriceForTier,
  TEAM_INCLUDED_SEATS,
  TEAM_MAX_SEATS,
  TEAM_SEAT_PRICE_MONTHLY,
  totalPriceForTierSeats,
} from "@/lib/config";
import { kr } from "@/lib/marketing/pricing-copy";
import { trpc } from "@/providers/trpc-provider";

type PlanTier = OnboardingPlanTier;

// Privat: én bruger, men samme moduler (#1012); egen liste, da Privat ikke
// viser Team-punkterne.
const FEATURE_KEYS = [0, 1, 2, 3] as const;

const SEAT_INFO: Record<
  "team" | "business",
  { included: number; max: number; seatPrice: number }
> = {
  team: {
    included: TEAM_INCLUDED_SEATS,
    max: TEAM_MAX_SEATS,
    seatPrice: TEAM_SEAT_PRICE_MONTHLY,
  },
  business: {
    included: BUSINESS_INCLUDED_SEATS,
    max: BUSINESS_MAX_SEATS,
    seatPrice: BUSINESS_SEAT_PRICE_MONTHLY,
  },
};

interface SubscriptionStepProps {
  onNext: (data: {
    billingCycle: "monthly" | "yearly";
    planTier: PlanTier;
    seatCount: number;
    isEffihubMigrant: boolean;
    promoCode?: string;
  }) => void;
  /** Privat-planen kan købes (Alunta-planer sat) og må derfor vælges. */
  privatAvailable?: boolean;
  initialData?: {
    billingCycle?: "monthly" | "yearly";
    planTier?: PlanTier;
    seatCount?: number;
    isEffihubMigrant?: boolean;
    promoCode?: string;
  };
}

export function SubscriptionStep({
  onNext,
  initialData,
  privatAvailable = false,
}: SubscriptionStepProps) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("onboarding.subscription");
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "yearly">(
    initialData?.billingCycle || "monthly",
  );
  const initialTier: PlanTier = initialData?.planTier ?? "solo";
  const [tier, setTier] = useState<PlanTier>(initialTier);
  const [seats, setSeats] = useState<number>(
    clampSeats(
      initialTier,
      initialData?.seatCount ?? includedSeatsForTier(initialTier),
    ),
  );

  // Kampagnekode: fra link-cookien eller tastet af brugeren.
  const [codeInput, setCodeInput] = useState(initialData?.promoCode ?? "");
  const [showCodeField, setShowCodeField] = useState(false);
  useEffect(() => {
    if (initialData?.promoCode) return;
    const fromCookie = readCampaignCookie();
    if (fromCookie) setCodeInput(fromCookie);
  }, [initialData?.promoCode]);
  const normalizedCode = normalizeCampaignCode(codeInput);
  const { data: campaign, isFetching: checkingCode } =
    trpc.onboarding.campaignCode.useQuery(
      { code: normalizedCode ?? "" },
      { enabled: !!normalizedCode },
    );
  const activeCampaign = campaign?.valid ? campaign : null;

  // Switch tier and re-clamp the seat count into the new tier's range.
  const changeTier = (next: PlanTier) => {
    setTier(next);
    setSeats((s) => clampSeats(next, s));
  };

  // Privat vises kun for brugere der kom ind på Privat (segmentside/prisside)
  // — de øvrige beholder det kendte valg mellem Selvstændig/Team/Virksomhed.
  const showPrivat = privatAvailable && initialTier === "privat";

  const seatInfo =
    tier === "solo" || tier === "privat" ? null : SEAT_INFO[tier];
  // Privat har hverken fakturering eller klippekort — vis ikke features den
  // ikke indeholder.
  const featureSet = tier === "privat" ? "privat" : "default";
  const features = FEATURE_KEYS.map((i) => ({
    key: `${featureSet}-${i}`,
    label: t(`features.${featureSet}.${i}`, {
      clients: PRIVAT_MAX_ACTIVE_CLIENTS,
    }),
  }));

  // Calculate prices for the selected tier + seats.
  const monthlyPrice = totalPriceForTierSeats(tier, "monthly", seats);
  const yearlyPrice = totalPriceForTierSeats(tier, "yearly", seats);

  const handleContinue = () => {
    onNext({
      billingCycle: selectedPlan,
      planTier: tier,
      seatCount: seats,
      isEffihubMigrant: false,
      promoCode: activeCampaign?.code,
    });
  };

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">
          {t("welcome", { brand: brand.name })}
        </h1>
        <p className="mt-4 text-lg text-gray-600">{t("subtitle")}</p>
      </div>

      {/* Trial Banner */}
      <div className="rounded-lg bg-brand-50 p-4 text-center">
        <p className="flex items-center justify-center gap-2 text-lg font-semibold text-brand-900 dark:text-brand-400">
          <Sparkles className="h-5 w-5" />
          {activeCampaign
            ? t("campaign", {
                code: activeCampaign.code,
                description: activeCampaign.description,
              })
            : t("trialLine")}
        </p>
        {activeCampaign && activeCampaign.discountPercent > 0 && (
          <p className="mt-1 text-sm text-brand-800 dark:text-brand-400">
            {t("discountNote")}
          </p>
        )}
      </div>

      {/* Kampagnekode */}
      <div className="mx-auto max-w-sm text-center">
        {showCodeField || (codeInput && !activeCampaign) ? (
          <div className="space-y-1">
            <label
              htmlFor="campaign-code"
              className="block text-sm font-medium text-gray-700"
            >
              {t("codeLabel")}
            </label>
            <input
              id="campaign-code"
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              autoComplete="off"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-center uppercase tracking-wide text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            />
            {normalizedCode && !checkingCode && campaign && !campaign.valid && (
              <p className="text-sm text-red-700" role="alert">
                {t("codeInvalid")}
              </p>
            )}
          </div>
        ) : (
          !activeCampaign && (
            <button
              type="button"
              onClick={() => setShowCodeField(true)}
              className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
            >
              {t("haveCode")}
            </button>
          )
        )}
      </div>

      {/* Plan tier toggle */}
      <div
        className={`mx-auto grid gap-3 ${
          showPrivat
            ? "max-w-3xl grid-cols-2 sm:grid-cols-4"
            : "max-w-2xl grid-cols-3"
        }`}
      >
        {showPrivat && (
          <button
            type="button"
            onClick={() => changeTier("privat")}
            className={`flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-3 text-sm font-semibold transition-all ${
              tier === "privat"
                ? "border-brand-600 dark:border-brand-400 bg-brand-50 text-brand-700 dark:text-brand-400"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            }`}
          >
            <House className="h-4 w-4" />
            {planNameForTier("privat")}
          </button>
        )}
        <button
          type="button"
          onClick={() => changeTier("solo")}
          className={`flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-3 text-sm font-semibold transition-all ${
            tier === "solo"
              ? "border-brand-600 dark:border-brand-400 bg-brand-50 text-brand-700 dark:text-brand-400"
              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
          }`}
        >
          <User className="h-4 w-4" />
          {planNameForTier("solo")}
        </button>
        <button
          type="button"
          onClick={() => changeTier("team")}
          className={`flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-3 text-sm font-semibold transition-all ${
            tier === "team"
              ? "border-brand-600 dark:border-brand-400 bg-brand-50 text-brand-700 dark:text-brand-400"
              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
          }`}
        >
          <Users className="h-4 w-4" />
          {t("planTeam")}
        </button>
        <button
          type="button"
          onClick={() => changeTier("business")}
          className={`flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-3 text-sm font-semibold transition-all ${
            tier === "business"
              ? "border-brand-600 dark:border-brand-400 bg-brand-50 text-brand-700 dark:text-brand-400"
              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
          }`}
        >
          <Building2 className="h-4 w-4" />
          {planNameForTier("business")}
        </button>
      </div>

      {seatInfo && (
        <div className="-mt-4 space-y-3">
          <p className="text-center text-sm text-gray-600">
            {t("seatsInfo", {
              included: seatInfo.included,
              price: kr(seatPriceForTier(tier, selectedPlan)),
              period:
                selectedPlan === "yearly" ? t("periodYear") : t("periodMonth"),
              max: seatInfo.max,
            })}
          </p>
          <div className="mx-auto flex max-w-xs items-center justify-center gap-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <span className="text-sm font-medium text-gray-700">
              {t("seats")}
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSeats((s) => clampSeats(tier, s - 1))}
                disabled={seats <= seatInfo.included}
                aria-label={t("fewerSeats")}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center text-lg font-bold text-gray-900">
                {seats}
              </span>
              <button
                type="button"
                onClick={() => setSeats((s) => clampSeats(tier, s + 1))}
                disabled={seats >= seatInfo.max}
                aria-label={t("moreSeats")}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subscription Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Monthly Plan */}
        <button
          type="button"
          onClick={() => setSelectedPlan("monthly")}
          className={`relative rounded-lg border-2 p-6 text-left transition-all ${
            selectedPlan === "monthly"
              ? "border-brand-600 dark:border-brand-400 bg-brand-50 shadow-lg"
              : "border-gray-200 bg-white hover:border-gray-300"
          }`}
        >
          {selectedPlan === "monthly" && (
            <div className="absolute right-4 top-4">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-tt-gran">
                <Check className="h-4 w-4 text-tt-paa-gran" />
              </div>
            </div>
          )}
          <div className="mb-2 inline-block rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800 dark:text-brand-400">
            {t("mostPopular")}
          </div>
          <h3 className="mb-2 text-2xl font-bold text-gray-900">
            {t("monthly")}
          </h3>
          <div className="mb-4">
            <span className="text-4xl font-bold text-gray-900">
              {kr(monthlyPrice)}
            </span>
            <span className="text-gray-600">{t("periodMonth")}</span>
          </div>
          <p className="mb-4 text-sm text-gray-600">{t("monthlyNote")}</p>
          <ul className="space-y-2 text-sm text-gray-700">
            {features.map((feature) => (
              <li key={feature.key} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                <span>{feature.label}</span>
              </li>
            ))}
          </ul>
        </button>

        {/* Yearly Plan */}
        <button
          type="button"
          onClick={() => setSelectedPlan("yearly")}
          className={`relative rounded-lg border-2 p-6 text-left transition-all ${
            selectedPlan === "yearly"
              ? "border-brand-600 dark:border-brand-400 bg-brand-50 shadow-lg"
              : "border-gray-200 bg-white hover:border-gray-300"
          }`}
        >
          {selectedPlan === "yearly" && (
            <div className="absolute right-4 top-4">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-tt-gran">
                <Check className="h-4 w-4 text-tt-paa-gran" />
              </div>
            </div>
          )}
          <div className="mb-2 inline-block rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
            {t("twoMonthsFreeBadge")}
          </div>
          <h3 className="mb-2 text-2xl font-bold text-gray-900">
            {t("yearly")}
          </h3>
          <div className="mb-4">
            <span className="text-4xl font-bold text-gray-900">
              {kr(yearlyPrice)}
            </span>
            <span className="text-gray-600">{t("periodYear")}</span>
          </div>
          <p className="mb-4 text-sm text-gray-600">{t("yearlyNote")}</p>
          <ul className="space-y-2 text-sm text-gray-700">
            {features.map((feature) => (
              <li key={feature.key} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-600" />
                <span>{feature.label}</span>
              </li>
            ))}
          </ul>
        </button>
      </div>

      {/* Continue Button */}
      <button
        type="button"
        onClick={handleContinue}
        disabled={checkingCode}
        className="w-full rounded-lg bg-tt-gran px-6 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-wait disabled:opacity-60"
      >
        {selectedPlan === "monthly"
          ? t("continueMonthly")
          : t("continueYearly")}
      </button>

      {/* Features Link */}
      <div className="text-center">
        <a
          href="/#features"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
        >
          {t("readMore")}
        </a>
      </div>
    </div>
  );
}
