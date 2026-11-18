"use client";

import { format } from "date-fns";
import { da, de, enGB, es } from "date-fns/locale";
import {
  AlertTriangle,
  Building2,
  Check,
  CreditCard,
  Download,
  ExternalLink,
  Percent,
  Receipt,
  Tag,
  TrendingUp,
  Trophy,
  User,
  Users,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { PageHeader } from "@/components/dashboard-nav";
import { AdminOnlyNotice } from "@/components/settings/AdminOnlyNotice";
import { StoreSubscriptionCard } from "@/components/subscription/StoreSubscriptionCard";
import { TimewrenBillingPanel } from "@/components/subscription/TimewrenBillingPanel";
import { FoundingCustomerBadge } from "@/components/ui/FoundingCustomerBadge";
import { FoundingTierBadge } from "@/components/ui/FoundingTierBadge";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { Modal } from "@/components/ui/Modal";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { toIntlLocale } from "@/i18n/format-locale";
import { PRIVAT_MAX_ACTIVE_CLIENTS } from "@/lib/billing/plan-gate";
import {
  basePriceForTier,
  includedSeatsForTier,
  maxSeatsForTier,
  type PlanTier,
  planNameForTier,
  seatPriceForTier,
} from "@/lib/config";
import type { RouterOutputs } from "@/lib/trpc/routers";
import { trpc } from "@/providers/trpc-provider";

/** Rangorden til opgraderings-logik: free < privat < solo < team < business. */
const TIER_RANK: Record<PlanTier, number> = {
  free: -2,
  privat: -1,
  solo: 0,
  team: 1,
  business: 2,
};

/** Tiers der kan vælges i plan-vælgeren. */
type PickerTier = "privat" | "solo" | "team" | "business";

type Translate = ReturnType<typeof useTranslations>;

const DATE_FNS_LOCALES: Record<string, typeof da> = { da, en: enGB, de, es };

function useDateFormat() {
  const t = useTranslations("settingsSubscription");
  const locale = useLocale();
  const dfLocale = DATE_FNS_LOCALES[locale] ?? da;
  return {
    short: (d: Date | string | number) =>
      format(new Date(d), t("format.shortDate"), { locale: dfLocale }),
    long: (d: Date | string | number) =>
      format(new Date(d), t("format.longDate"), { locale: dfLocale }),
  };
}

function getTierMeta(
  t: Translate,
): Record<
  PickerTier,
  { name: string; tagline: string; icon: typeof User; features: string[] }
> {
  return {
    privat: {
      name: planNameForTier("privat"),
      tagline: t("tiers.privat.tagline"),
      icon: User,
      features: [
        t("tiers.privat.feature1"),
        t("tiers.privat.feature2", { clients: PRIVAT_MAX_ACTIVE_CLIENTS }),
        t("tiers.privat.feature3"),
      ],
    },
    solo: {
      name: planNameForTier("solo"),
      tagline: t("tiers.solo.tagline"),
      icon: User,
      features: [
        t("tiers.solo.feature1"),
        t("tiers.solo.feature2"),
        t("tiers.solo.feature3"),
      ],
    },
    team: {
      name: planNameForTier("team"),
      tagline: t("tiers.team.tagline"),
      icon: Users,
      features: [
        t("tiers.team.feature1", { plan: planNameForTier("solo") }),
        t("tiers.team.feature2"),
        t("tiers.team.feature3"),
      ],
    },
    business: {
      name: planNameForTier("business"),
      tagline: t("tiers.business.tagline"),
      icon: Building2,
      features: [
        t("tiers.business.feature1", { plan: "Team" }),
        t("tiers.business.feature2"),
        t("tiers.business.feature3"),
      ],
    },
  };
}

function InvoiceStatusBadge({ status }: { status: string | null }) {
  const t = useTranslations("settingsSubscription");
  const config: Record<string, { label: string; color: string }> = {
    paid: {
      label: t("invoiceStatus.paid"),
      color:
        "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    },
    open: {
      label: t("invoiceStatus.open"),
      color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    },
    draft: {
      label: t("invoiceStatus.draft"),
      color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
    },
    void: {
      label: t("invoiceStatus.void"),
      color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    },
    uncollectible: {
      label: t("invoiceStatus.uncollectible"),
      color:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    },
  };
  const s = config[status || ""] || {
    label: status || t("invoiceStatus.unknown"),
    color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.color}`}
    >
      {s.label}
    </span>
  );
}

type InvoiceHistoryItem =
  RouterOutputs["subscription"]["getInvoiceHistory"][number];

function InvoiceHistory({
  invoices,
  title,
}: {
  invoices: InvoiceHistoryItem[];
  title?: string;
}) {
  const t = useTranslations("settingsSubscription");
  const intl = toIntlLocale(useLocale());
  const dates = useDateFormat();
  const heading = title ?? t("history.title");
  return (
    <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
        {heading}
      </h2>
      {invoices.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{heading}</caption>
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="pb-2 text-left font-medium text-gray-500 dark:text-gray-400">
                  {t("history.columnDate")}
                </th>
                <th className="pb-2 text-left font-medium text-gray-500 dark:text-gray-400">
                  {t("history.columnNumber")}
                </th>
                <th className="pb-2 text-right font-medium text-gray-500 dark:text-gray-400">
                  {t("history.columnAmount")}
                </th>
                <th className="pb-2 text-center font-medium text-gray-500 dark:text-gray-400">
                  {t("history.columnStatus")}
                </th>
                <th className="pb-2 text-right font-medium text-gray-500 dark:text-gray-400">
                  {t("history.columnPdf")}
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr
                  key={inv.id}
                  className="border-b border-gray-100 dark:border-gray-700/50 last:border-0"
                >
                  <td className="py-2.5 text-gray-900 dark:text-white">
                    {dates.short(inv.createdAt)}
                  </td>
                  <td className="py-2.5 text-gray-600 dark:text-gray-400">
                    {inv.number || "–"}
                  </td>
                  <td className="py-2.5 text-right text-gray-900 dark:text-white">
                    {(inv.total / 100).toLocaleString(intl, {
                      minimumFractionDigits: 2,
                    })}{" "}
                    kr
                  </td>
                  <td className="py-2.5 text-center">
                    <InvoiceStatusBadge status={inv.status} />
                  </td>
                  <td className="py-2.5 text-right">
                    {inv.pdfUrl && (
                      <a
                        href={inv.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
                      >
                        <Download className="h-3.5 w-3.5" />
                        PDF
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("history.empty")}
        </p>
      )}
    </div>
  );
}

export default function SubscriptionPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("settingsSubscription");
  const locale = useLocale();
  const intl = toIntlLocale(locale);
  const dates = useDateFormat();
  const tierMeta = getTierMeta(t);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [upgradeCycle, setUpgradeCycle] = useState<"monthly" | "yearly">(
    "monthly",
  );
  // Ønsket antal EKSTRA pladser i pladsvælgeren. null = endnu ikke rørt af
  // brugeren; så vises kundens nuværende tilkøb (eller minimum).
  const [desiredExtraSeats, setDesiredExtraSeats] = useState<number | null>(
    null,
  );
  // Rå tekst i talfeltet mens det har fokus — der clampes først ved blur/
  // submit, så man kan slette og taste frit (serveren validerer alligevel).
  const [seatDraft, setSeatDraft] = useState<string | null>(null);
  // Efter en tier-opgradering med medbragt plads-kapacitet: mind kunden om at
  // gentegne ekstra pladser på den nye tiers sats (sat fra ?reseats=N).
  const [reseatsReminder, setReseatsReminder] = useState<number | null>(null);

  const utils = trpc.useUtils();

  // Uden billing (selvhost) findes siden ikke: ingen forespørgsler, kun en note
  const {
    enabled: billingEnabled,
    checkoutAvailable,
    provider,
    isLoading: billingLoading,
  } = useBillingEnabled();
  // TimeWren betaler med Stripe (TimewrenBillingPanel): ingen Alunta-opslag.
  const isStripe = provider === "stripe";
  const billingQuery = { enabled: billingEnabled && !isStripe };

  const { data: details, isLoading } = trpc.subscription.getDetails.useQuery();
  const { data: seatInfo } = trpc.organization.checkSeatAvailability.useQuery();
  const { data: foundingOrg } = trpc.organization.getFounding.useQuery();
  const { data: myTier } = trpc.foundingTier.getMyTier.useQuery(
    undefined,
    billingQuery,
  );
  const { data: usageStats, isLoading: statsLoading } =
    trpc.subscription.getUsageStats.useQuery(undefined, billingQuery);
  const { data: invoiceHistory } = trpc.subscription.getInvoiceHistory.useQuery(
    undefined,
    billingQuery,
  );
  const { data: transactions } = trpc.subscription.getTransactions.useQuery(
    undefined,
    billingQuery,
  );
  const { data: discounts } = trpc.subscription.getDiscounts.useQuery(
    undefined,
    billingQuery,
  );
  const { data: subscriptionMetadata } =
    trpc.subscription.getSubscriptionMetadata.useQuery(undefined, billingQuery);

  const createCheckoutMutation =
    trpc.subscription.createCheckoutSession.useMutation({
      onError: (error) => toast.error(error.message),
    });
  const createPortalMutation =
    trpc.subscription.createPortalSession.useMutation({
      onError: (error) => toast.error(error.message),
    });
  const purchaseSeatsMutation =
    trpc.subscription.purchaseExtraSeats.useMutation({
      onError: (error) => toast.error(error.message),
    });
  const changePlanMutation = trpc.subscription.changePlan.useMutation({
    onSuccess: (_data, variables) => {
      utils.subscription.getDetails.invalidate();
      toast.success(
        variables.billingCycle === "yearly"
          ? t("toast.planChangedYearly")
          : t("toast.planChangedMonthly"),
      );
    },
    onError: (error) => toast.error(error.message),
  });
  const cancelMutation = trpc.subscription.cancel.useMutation({
    onSuccess: () => {
      utils.subscription.getDetails.invalidate();
      setShowCancelModal(false);
      toast.success(t("toast.canceled"));
    },
    onError: (error) => toast.error(error.message),
  });
  const reactivateMutation = trpc.subscription.reactivate.useMutation({
    onSuccess: () => {
      utils.subscription.getDetails.invalidate();
      toast.success(t("toast.reactivated"));
    },
    onError: (error) => toast.error(error.message),
  });
  const trialExtensionMutation =
    trpc.subscription.requestTrialExtension.useMutation({
      onSuccess: () => {
        toast.success(t("toast.trialRequested"));
      },
      onError: () => {
        toast.error(t("toast.trialRequestFailed"));
      },
    });

  // Handle success/cancel redirects from checkout
  useEffect(() => {
    // Vent på udbyderen, så Stripe-genhentningen nedenfor ikke misses.
    if (billingLoading) return;
    if (searchParams.get("success") === "true") {
      toast.success(t("toast.paymentMethodAdded"));
      // Track Google Ads conversion
      import("@/components/GoogleAds").then(({ trackGoogleConversion }) => {
        trackGoogleConversion("subscribe");
      });
      // Opgradering med medbragte ekstra pladser: led direkte til pladskøbet
      // på den nye tier, så add-on'en gentegnes (og faktureres) korrekt.
      const reseats = Number.parseInt(searchParams.get("reseats") ?? "", 10);
      if (Number.isFinite(reseats) && reseats > 0) {
        setReseatsReminder(reseats);
        setDesiredExtraSeats(reseats);
      }
      utils.subscription.getDetails.invalidate();
      if (isStripe) {
        // Stripe-webhooken kan lande lidt efter kunden: hent igen om lidt.
        utils.timewrenBilling.overview.invalidate();
        setTimeout(() => {
          utils.timewrenBilling.overview.invalidate();
          utils.subscription.getDetails.invalidate();
        }, 4000);
      }
      router.replace("/dashboard/settings/subscription");
    }
    if (searchParams.get("seats_success") === "true") {
      toast.success(t("toast.seatsUpdated"));
      utils.subscription.getDetails.invalidate();
      utils.organization.checkSeatAvailability.invalidate();
      router.replace("/dashboard/settings/subscription");
    }
    if (searchParams.get("canceled") === "true") {
      toast.info(t("toast.paymentCanceled"));
      router.replace("/dashboard/settings/subscription");
    }
  }, [searchParams, utils, router, t, isStripe, billingLoading]);

  const handleCheckout = async (billingCycle?: "monthly" | "yearly") => {
    const result = await createCheckoutMutation.mutateAsync({
      billingCycle,
      // Keep the tier + seats the customer is already on (e.g. team trial) so
      // adding payment doesn't silently downgrade them to solo / fewer seats.
      // Gratis kan ikke købes — serveren vælger Solo for en Gratis-kunde.
      planTier: (details?.planTier && details.planTier !== "free"
        ? details.planTier
        : undefined) as "privat" | "solo" | "team" | "business" | undefined,
      seatCount: details?.seatCount ?? undefined,
    });
    if (result.url) window.location.href = result.url;
  };

  const handlePortal = async () => {
    const result = await createPortalMutation.mutateAsync();
    if (result.url) window.location.href = result.url;
  };

  const handleChangePlan = async (billingCycle: "monthly" | "yearly") => {
    await changePlanMutation.mutateAsync({ billingCycle });
  };

  // Self-purchase / upgrade to a specific tier. Charges the base plan (extra
  // seats handled separately) and redirects to Alunta checkout.
  const handleTierCheckout = async (tier: PickerTier) => {
    const result = await createCheckoutMutation.mutateAsync({
      planTier: tier,
      billingCycle: upgradeCycle,
      seatCount: includedSeatsForTier(tier),
    });
    if (result.url) window.location.href = result.url;
  };

  // Self-service tilkøb/ændring af ekstra pladser — checkout på seats-planen
  // med det ønskede TOTALE antal ekstra; webhooken annullerer det gamle tilkøb.
  const handlePurchaseSeats = async (totalExtraSeats: number) => {
    const result = await purchaseSeatsMutation.mutateAsync({ totalExtraSeats });
    if (result.url) window.location.href = result.url;
  };

  if (!billingEnabled) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={t("header.title")}
          description={t("header.description")}
        />
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
          <p className="text-gray-600 dark:text-gray-400">
            {t("states.noBilling")}
          </p>
        </div>
      </div>
    );
  }

  // TimeWren Cloud: planer i EUR, Stripe Checkout og kundeportal.
  if (isStripe) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={t("header.title")}
          description={t("header.description")}
        />
        <AdminOnlyNotice>{t("header.adminOnly")}</AdminOnlyNotice>
        <TimewrenBillingPanel />
      </div>
    );
  }

  // TimeWren uden betaling: kontoen er på Gratis
  // (lib/billing/brand-billing.ts). Ingen planvalg eller checkout her.
  if (!checkoutAvailable) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={t("header.title")}
          description={t("header.description")}
        />
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
          <p className="font-medium text-gray-900 dark:text-white">
            {t("states.comingSoonTitle")}
          </p>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {t("states.comingSoon")}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={t("header.title")}
          description={t("header.description")}
        />
        <LoadingScreen message={t("states.loading")} />
      </div>
    );
  }

  if (!details) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={t("header.title")}
          description={t("header.description")}
        />
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 text-center">
          <p className="text-gray-600 dark:text-gray-400">{t("states.none")}</p>
          <button
            type="button"
            onClick={() => handleCheckout()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-6 py-2.5 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
          >
            <CreditCard className="h-4 w-4" />
            {t("states.choosePlan")}
          </button>
        </div>
      </div>
    );
  }

  // Købt i appen: butikken fakturerer, så ingen Alunta-knapper her.
  if (details.storeManaged) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <PageHeader
          title={t("header.title")}
          description={t("header.description")}
        />
        <StoreSubscriptionCard details={details} />
        {/* Fakturaer fra et tidligere web-abonnement forbliver tilgængelige. */}
        {invoiceHistory && invoiceHistory.length > 0 && (
          <InvoiceHistory
            invoices={invoiceHistory}
            title={t("states.previousWebPayments")}
          />
        )}
      </div>
    );
  }

  const statusConfig: Record<string, { label: string; color: string }> = {
    active: {
      label: t("status.active"),
      color:
        "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    },
    free: {
      label: t("status.free"),
      color: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
    },
    trialing: {
      label: t("status.trialing"),
      color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    },
    past_due: {
      label: t("status.pastDue"),
      color:
        "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    },
    canceled: {
      label: t("status.canceled"),
      color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    },
  };

  const status = statusConfig[details.status] || statusConfig.active;
  const isTrialing = details.status === "trialing";
  const isCanceled = details.status === "canceled" || details.cancelAtPeriodEnd;
  const currentCycle = details.billingCycle as "monthly" | "yearly";

  // ── Pladser + opgradering (self-service, #420) ─────────────────────
  const currentTier = (details.planTier ?? "solo") as PlanTier;
  const isLive = details.status === "active" || isTrialing;
  const includedSeats = details.includedSeats;
  const maxExtraSeats = Math.max(
    0,
    maxSeatsForTier(currentTier) - includedSeats,
  );
  const currentExtraSeats = details.extraSeats ?? 0;
  const seatsUsed = seatInfo?.seatsUsed ?? 0;
  const pendingInvites = seatInfo?.pendingInvites ?? 0;
  // Man kan ikke købe sig ned under de pladser der allerede er i brug
  // (medlemmer + afventende invitationer) — og minimum er 1 ekstra plads.
  const minExtraSeats = Math.max(1, seatsUsed - includedSeats);
  const clampExtra = (n: number) =>
    Math.min(maxExtraSeats, Math.max(minExtraSeats, Math.round(n)));
  const effectiveExtraSeats = clampExtra(
    desiredExtraSeats ?? Math.max(currentExtraSeats, minExtraSeats),
  );
  // Talfeltet holder rå tekst mens der tastes (ingen clamp pr. tastetryk) —
  // pendingExtraSeats er den clampede fortolkning til pris/knap, og der
  // committes ved blur/submit.
  const seatDraftParsed =
    seatDraft === null ? Number.NaN : Number.parseInt(seatDraft, 10);
  const pendingExtraSeats = Number.isFinite(seatDraftParsed)
    ? clampExtra(seatDraftParsed)
    : effectiveExtraSeats;
  const commitSeatDraft = () => {
    setSeatDraft(null);
    setDesiredExtraSeats(pendingExtraSeats);
  };
  const seatUnitPrice =
    details.seatUnitPrice ?? seatPriceForTier(currentTier, currentCycle);
  const seatPriceSuffix =
    currentCycle === "yearly"
      ? t("seats.priceSuffixYearly")
      : t("seats.priceSuffixMonthly");
  const showSeatsSection =
    !!details.aluntaSubscriptionId &&
    !isCanceled &&
    isLive &&
    (currentTier === "team" || currentTier === "business") &&
    details.seatsPlanConfigured &&
    maxExtraSeats > 0;
  const upgradeTargets = (["team", "business"] as PickerTier[]).filter(
    (tier) => TIER_RANK[tier] > TIER_RANK[currentTier],
  );
  const showUpgradeSection =
    !!details.aluntaSubscriptionId &&
    !isCanceled &&
    isLive &&
    upgradeTargets.length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title={t("header.title")}
        description={t("header.description")}
      />

      <AdminOnlyNotice>{t("header.adminOnly")}</AdminOnlyNotice>

      {/* Trial Banner */}
      {isTrialing && (
        <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-brand-900 dark:text-brand-300">
                {t("trial.daysLeft", { count: details.trialDaysRemaining })}
              </p>
              <p className="mt-1 text-sm text-brand-700 dark:text-brand-400">
                {details.aluntaSubscriptionId
                  ? t("trial.startsAutomatically")
                  : t("trial.addPaymentToContinue")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => trialExtensionMutation.mutate()}
                disabled={trialExtensionMutation.isPending}
                className="text-sm text-brand-600 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300 underline disabled:opacity-50"
              >
                {t("trial.needMoreTime")}
              </button>
              {!details.aluntaSubscriptionId && (
                <button
                  type="button"
                  onClick={() => handleCheckout()}
                  disabled={createCheckoutMutation.isPending}
                  className="rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
                >
                  {t("trial.addPayment")}
                </button>
              )}
            </div>
          </div>
          {!details.aluntaSubscriptionId &&
            myTier &&
            myTier.discountPercent > 0 && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                {t("trial.checkoutNoteFounding", {
                  percent: myTier.discountPercent,
                })}
              </p>
            )}
        </div>
      )}

      {/* Pending Cancellation Banner */}
      {details.cancelAtPeriodEnd && details.status !== "canceled" && (
        <div className="rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
              <div>
                <p className="font-medium text-yellow-900 dark:text-yellow-300">
                  {details.currentPeriodEnd
                    ? t("pendingCancel.expiresOn", {
                        date: dates.long(details.currentPeriodEnd),
                      })
                    : t("pendingCancel.expiresUnknown")}
                </p>
                <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-400">
                  {t("pendingCancel.reactivateHint")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => reactivateMutation.mutate()}
              disabled={reactivateMutation.isPending}
              className="shrink-0 rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-yellow-700 disabled:opacity-50"
            >
              {reactivateMutation.isPending
                ? t("pendingCancel.reactivating")
                : t("pendingCancel.reactivate")}
            </button>
          </div>
        </div>
      )}

      {/* Current Plan Card */}
      <div
        id="plan"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
          {t("plan.current")}
        </h2>
        <div className="flex items-start justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {details.planName}
              </h3>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.color}`}
              >
                {status.label}
              </span>
              {!details.isFree && (
                <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                  {currentCycle === "yearly"
                    ? t("cycle.yearly")
                    : t("cycle.monthly")}
                </span>
              )}
              {foundingOrg?.isFounding && <FoundingCustomerBadge />}
              {myTier && (
                <FoundingTierBadge
                  tier={myTier.key}
                  discountPercent={myTier.discountPercent}
                  showDiscount
                />
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {details.displayPrice}
              </p>
              {details.originalPrice && (
                <p className="text-lg text-gray-400 line-through">
                  {details.originalPrice}
                </p>
              )}
            </div>
            {details.isFree && details.limits.maxActiveClients !== null && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("plan.freeLimits", {
                  maxSeats: details.limits.maxSeats,
                  used: details.usage.activeClients,
                  maxClients: details.limits.maxActiveClients,
                })}
              </p>
            )}
            {!details.isFree &&
              details.planTier === "privat" &&
              details.limits.maxActiveClients !== null && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {details.usage.activeClients} af{" "}
                  {details.limits.maxActiveClients} aktive kunder i brug. Skift
                  til Selvstændig for ubegrænset antal kunder.
                </p>
              )}
            {(details.planTier === "team" ||
              details.planTier === "business") && (
              <p className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                <Users className="h-4 w-4" />
                {details.extraSeats && details.extraSeats > 0
                  ? t("plan.seatsWithExtra", {
                      count: details.seatCount ?? 0,
                      included: details.includedSeats,
                      extra: details.extraSeats,
                    })
                  : t("plan.seatsIncluded", { count: details.seatCount ?? 0 })}
              </p>
            )}
            {myTier && (
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                {myTier.discountForever
                  ? t("plan.foundingDiscountForever", {
                      percent: myTier.discountPercent,
                    })
                  : myTier.discountExpiresAt
                    ? t("plan.foundingDiscountExpires", {
                        percent: myTier.discountPercent,
                        date: new Date(
                          myTier.discountExpiresAt,
                        ).toLocaleDateString(intl),
                      })
                    : t("plan.foundingDiscount", {
                        percent: myTier.discountPercent,
                      })}
              </p>
            )}
            {details.nextBillingDate && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {isTrialing
                  ? t("plan.trialEnds", {
                      date: dates.long(details.nextBillingDate),
                    })
                  : t("plan.nextBilling", {
                      date: dates.long(details.nextBillingDate),
                    })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ROI Stats */}
      {!statsLoading && usageStats && (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
            {usageStats.totalCost > 0
              ? t("roi.titleReturn", { brand: brand.name })
              : t("roi.titleActivity", { brand: brand.name })}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Cost */}
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <CreditCard className="h-4 w-4" />
                {t("roi.spent", { brand: brand.name })}
              </div>
              <p className="mt-2 text-xl font-bold text-gray-900 dark:text-white">
                {usageStats.totalCost > 0
                  ? `${usageStats.totalCost.toLocaleString(intl)} kr`
                  : t("roi.freeSoFar")}
              </p>
            </div>

            {/* Tracked value */}
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <TrendingUp className="h-4 w-4" />
                {t("roi.trackedValue")}
              </div>
              <p className="mt-2 text-xl font-bold text-gray-900 dark:text-white">
                {usageStats.totalTrackedValue.toLocaleString(intl)} kr
              </p>
            </div>

            {/* Invoiced */}
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Receipt className="h-4 w-4" />
                {t("roi.invoicedTotal")}
              </div>
              <p className="mt-2 text-xl font-bold text-gray-900 dark:text-white">
                {usageStats.totalInvoiced.toLocaleString(intl)} kr
              </p>
            </div>

            {/* ROI */}
            <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Trophy className="h-4 w-4" />
                {t("roi.return")}
              </div>
              <p className="mt-2 text-xl font-bold text-gray-900 dark:text-white">
                {usageStats.totalCost > 0
                  ? `${usageStats.roiMultiplier}x`
                  : "–"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Payment Management */}
      <div
        id="betaling"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
          {t("payment.title")}
        </h2>
        {details.aluntaSubscriptionId ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("payment.portalDescription")}
            </p>
            <button
              type="button"
              onClick={handlePortal}
              disabled={createPortalMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              <ExternalLink className="h-4 w-4" />
              {t("payment.manage")}
            </button>
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              {t("payment.noMethod")}
            </p>
            <button
              type="button"
              onClick={() => handleCheckout()}
              disabled={createCheckoutMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4" />
              {createCheckoutMutation.isPending
                ? t("states.redirecting")
                : t("payment.addMethod")}
            </button>
            {myTier && myTier.discountPercent > 0 && (
              <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                {t("payment.checkoutNoteFounding", {
                  percent: myTier.discountPercent,
                })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Pladser — self-service tilkøb/ændring af ekstra pladser (#420).
          Checkout på seats-add-on-planen med det ønskede totale antal;
          webhooken annullerer det gamle tilkøb når det nye aktiveres. */}
      {showSeatsSection && (
        <div
          id="pladser"
          className="scroll-mt-24 rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
        >
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <Users className="h-4 w-4" />
            {t("seats.title")}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("seats.usage", {
              used: seatsUsed,
              total: details.seatCount ?? includedSeats,
            })}
            {pendingInvites > 0 &&
              ` · ${t("seats.pendingInvites", { count: pendingInvites })}`}
          </p>
          {reseatsReminder !== null && (
            <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
              {t("seats.reseatsReminder", {
                count: reseatsReminder,
                plan: details.planName,
              })}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div>
              <label
                htmlFor="extra-seats"
                className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400"
              >
                {t("seats.extraLabel", { included: includedSeats })}
              </label>
              <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  aria-label={t("seats.fewer")}
                  onClick={() => {
                    setSeatDraft(null);
                    setDesiredExtraSeats(clampExtra(pendingExtraSeats - 1));
                  }}
                  disabled={pendingExtraSeats <= minExtraSeats}
                  className="px-3 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 rounded-l-lg"
                >
                  −
                </button>
                <input
                  id="extra-seats"
                  type="number"
                  min={minExtraSeats}
                  max={maxExtraSeats}
                  value={seatDraft ?? String(effectiveExtraSeats)}
                  onChange={(e) => setSeatDraft(e.target.value)}
                  onBlur={commitSeatDraft}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitSeatDraft();
                  }}
                  className="w-16 border-x border-gray-200 dark:border-gray-700 bg-transparent py-2 text-center text-sm font-medium text-gray-900 dark:text-white focus:outline-none"
                />
                <button
                  type="button"
                  aria-label={t("seats.more")}
                  onClick={() => {
                    setSeatDraft(null);
                    setDesiredExtraSeats(clampExtra(pendingExtraSeats + 1));
                  }}
                  disabled={pendingExtraSeats >= maxExtraSeats}
                  className="px-3 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 rounded-r-lg"
                >
                  +
                </button>
              </div>
            </div>
            <div className="pb-0.5">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("seats.price")}
              </p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("seats.priceLine", {
                  count: pendingExtraSeats,
                  unit: seatUnitPrice.toLocaleString(intl),
                  total: (pendingExtraSeats * seatUnitPrice).toLocaleString(
                    intl,
                  ),
                  suffix: seatPriceSuffix,
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                commitSeatDraft();
                void handlePurchaseSeats(pendingExtraSeats);
              }}
              disabled={
                purchaseSeatsMutation.isPending ||
                pendingExtraSeats === currentExtraSeats
              }
              className="rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
            >
              {purchaseSeatsMutation.isPending
                ? t("states.redirecting")
                : currentExtraSeats > 0
                  ? t("seats.adjust")
                  : t("seats.buy")}
            </button>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {t("seats.note", { max: maxSeatsForTier(currentTier) })}
          </p>
        </div>
      )}

      {/* Opgradér plan — for eksisterende betalere (#420). Ny checkout på den
          højere tier; webhooken annullerer den gamle base (og evt. team-seats)
          når den nye er aktiveret. */}
      {showUpgradeSection && (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("upgrade.title")}
            </h2>
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
              <button
                type="button"
                onClick={() => setUpgradeCycle("monthly")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  upgradeCycle === "monthly"
                    ? "bg-tt-gran text-tt-paa-gran"
                    : "text-gray-600 dark:text-gray-300"
                }`}
              >
                {t("cycle.monthly")}
              </button>
              <button
                type="button"
                onClick={() => setUpgradeCycle("yearly")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  upgradeCycle === "yearly"
                    ? "bg-tt-gran text-tt-paa-gran"
                    : "text-gray-600 dark:text-gray-300"
                }`}
              >
                {t("cycle.yearly")}{" "}
                <span className="text-xs opacity-80">
                  ({t("cycle.twoMonthsFree")})
                </span>
              </button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {upgradeTargets.map((tier) => {
              const meta = tierMeta[tier];
              const Icon = meta.icon;
              const price = basePriceForTier(tier, upgradeCycle);
              // Kapaciteten følger med ved opgradering (#424): har org'en
              // flere pladser end den nye tier inkluderer, skal de kunne
              // gentegnes som add-on — ellers blokeres selvbetjening, så
              // ingen mister betalte pladser.
              const carryCapacity = details.seatCount ?? includedSeats;
              const neededExtra = Math.max(
                0,
                carryCapacity - includedSeatsForTier(tier),
              );
              const targetSeatsConfigured =
                details.seatsPlanConfiguredByTier?.[
                  tier as "team" | "business"
                ] ?? false;
              const upgradeBlocked = neededExtra > 0 && !targetSeatsConfigured;
              return (
                <div
                  key={tier}
                  className="flex flex-col rounded-lg border-2 border-gray-200 dark:border-gray-700 p-5"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {meta.name}
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {meta.tagline}
                  </p>
                  <p className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">
                    {price.toLocaleString(intl)} kr.
                    <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                      {upgradeCycle === "yearly"
                        ? t("cycle.perYearExclVat")
                        : t("cycle.perMonthExclVat")}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t("tiers.usersIncluded", {
                      count: includedSeatsForTier(tier),
                    })}
                  </p>
                  <ul className="mt-3 flex-1 space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
                    {meta.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {upgradeBlocked ? (
                    <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300">
                      {t("upgrade.blocked", {
                        count: neededExtra,
                        plan: meta.name,
                      })}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleTierCheckout(tier)}
                      disabled={createCheckoutMutation.isPending}
                      className="mt-4 w-full rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
                    >
                      {createCheckoutMutation.isPending
                        ? t("states.redirecting")
                        : t("upgrade.to", { plan: meta.name })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {t("upgrade.note")}
          </p>
        </div>
      )}

      {/* Vælg / opgradér plan — self-service for brugere uden aktivt betalt
          abonnement (trial eller ubetalt). Lader dem selv købe Solo/Team/
          Business direkte fra dashboardet. Aktive betalere skifter tier via
          betalingsportalen for at undgå dobbelt-abonnementer. */}
      {!isCanceled && !details.aluntaSubscriptionId && (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("choose.title")}
            </h2>
            {/* Billing cycle toggle */}
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-0.5">
              <button
                type="button"
                onClick={() => setUpgradeCycle("monthly")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  upgradeCycle === "monthly"
                    ? "bg-tt-gran text-tt-paa-gran"
                    : "text-gray-600 dark:text-gray-300"
                }`}
              >
                {t("cycle.monthly")}
              </button>
              <button
                type="button"
                onClick={() => setUpgradeCycle("yearly")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  upgradeCycle === "yearly"
                    ? "bg-tt-gran text-tt-paa-gran"
                    : "text-gray-600 dark:text-gray-300"
                }`}
              >
                {t("cycle.yearly")}{" "}
                <span className="text-xs opacity-80">
                  ({t("cycle.twoMonthsFree")})
                </span>
              </button>
            </div>
          </div>
          <div
            className={`grid gap-4 sm:grid-cols-2 ${details.privatAvailable ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
          >
            {(
              [
                ...(details.privatAvailable ? ["privat"] : []),
                "solo",
                "team",
                "business",
              ] as PickerTier[]
            ).map((tier) => {
              const meta = tierMeta[tier];
              const Icon = meta.icon;
              const price = basePriceForTier(tier, upgradeCycle);
              const isCurrent = (details.planTier ?? "solo") === tier;
              return (
                <div
                  key={tier}
                  className={`flex flex-col rounded-lg border-2 p-5 transition-colors ${
                    isCurrent
                      ? "border-brand-600 bg-brand-50/50 dark:bg-tt-gran-lys"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {meta.name}
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {meta.tagline}
                  </p>
                  <p className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">
                    {price.toLocaleString(intl)} kr.
                    <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                      {upgradeCycle === "yearly"
                        ? t("cycle.perYearExclVat")
                        : t("cycle.perMonthExclVat")}
                    </span>
                  </p>
                  {(tier === "team" || tier === "business") && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {t("tiers.usersIncluded", {
                        count: includedSeatsForTier(tier),
                      })}
                    </p>
                  )}
                  <ul className="mt-3 flex-1 space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
                    {meta.features.map((f) => (
                      <li key={f} className="flex items-start gap-2">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    onClick={() => handleTierCheckout(tier)}
                    disabled={createCheckoutMutation.isPending}
                    className="mt-4 w-full rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
                  >
                    {createCheckoutMutation.isPending
                      ? t("states.redirecting")
                      : isCurrent
                        ? t("choose.chooseAndPay")
                        : t("choose.choosePlan", { plan: meta.name })}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            {t("choose.note", { plan: planNameForTier("solo") })}
          </p>
        </div>
      )}

      {/* Active Discounts */}
      {discounts && discounts.length > 0 && (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Tag className="h-5 w-5 text-green-600 dark:text-green-400" />
            {t("discounts.title")}
          </h2>
          <div className="space-y-3">
            {discounts.map((discount) => (
              <div
                key={discount.uuid}
                className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4"
              >
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">
                    {discount.discount_name}
                  </p>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {discount.effective_date && discount.end_date
                      ? t("discounts.rangeBoth", {
                          from: dates.short(discount.effective_date),
                          to: dates.short(discount.end_date),
                        })
                      : discount.effective_date
                        ? t("discounts.rangeOpenEnded", {
                            from: dates.short(discount.effective_date),
                          })
                        : discount.end_date
                          ? t("discounts.rangeUntil", {
                              to: dates.short(discount.end_date),
                            })
                          : t("discounts.rangeNone")}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 rounded-full bg-green-100 dark:bg-green-900/30 px-3 py-1">
                  <Percent className="h-3.5 w-3.5 text-green-700 dark:text-green-400" />
                  <span className="text-sm font-semibold text-green-800 dark:text-green-400">
                    {discount.discount_type === "percent"
                      ? `${discount.discount_value}%`
                      : `${discount.discount_value} kr`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscription Metadata */}
      {subscriptionMetadata && Object.keys(subscriptionMetadata).length > 0 && (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
            {t("metadata.title")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(subscriptionMetadata).map(([key, value]) => {
              if (value === null || value === undefined || value === "")
                return null;
              const labels: Record<string, string> = {
                founding_tier: t("metadata.foundingTier"),
                billing_cycle: t("metadata.billingCycle"),
                signup_source: t("metadata.signupSource"),
                coupon_code: t("metadata.couponCode"),
              };
              const displayLabel = labels[key] || key;
              const displayValue =
                value === "monthly"
                  ? t("cycle.monthly")
                  : value === "yearly"
                    ? t("cycle.yearly")
                    : String(value);
              return (
                <div
                  key={key}
                  className="rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-3"
                >
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {displayLabel}
                  </p>
                  <p className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                    {displayValue}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming Transactions */}
      {details.aluntaSubscriptionId &&
        transactions &&
        transactions.filter((tx) => !tx.isInvoiced).length > 0 && (
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
              {t("upcoming.title")}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t("upcoming.title")}</caption>
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="pb-2 text-left font-medium text-gray-500 dark:text-gray-400">
                      {t("upcoming.columnPeriod")}
                    </th>
                    <th className="pb-2 text-left font-medium text-gray-500 dark:text-gray-400">
                      {t("upcoming.columnPlan")}
                    </th>
                    <th className="pb-2 text-right font-medium text-gray-500 dark:text-gray-400">
                      {t("upcoming.columnAmount")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions
                    .filter((tx) => !tx.isInvoiced)
                    .map((tx) => (
                      <tr
                        key={tx.id}
                        className="border-b border-gray-100 dark:border-gray-700/50 last:border-0"
                      >
                        <td className="py-2.5 text-gray-900 dark:text-white">
                          {dates.short(tx.periodStart)} –{" "}
                          {dates.short(tx.periodEnd)}
                        </td>
                        <td className="py-2.5 text-gray-600 dark:text-gray-400">
                          {tx.planName}
                        </td>
                        <td className="py-2.5 text-right text-gray-900 dark:text-white">
                          {(tx.price / 100).toLocaleString(intl, {
                            minimumFractionDigits: 2,
                          })}{" "}
                          {tx.currency}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {/* Invoice History */}
      {details.aluntaSubscriptionId && (
        <InvoiceHistory invoices={invoiceHistory ?? []} />
      )}

      {/* Plan Selection */}
      {!isCanceled && details.aluntaSubscriptionId && (
        <div
          id="skift-plan"
          className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
        >
          <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
            {t("switch.title")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Monthly */}
            <div
              className={`rounded-lg border-2 p-5 transition-colors ${
                currentCycle === "monthly"
                  ? "border-brand-600 bg-brand-50/50 dark:bg-tt-gran-lys"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">
                    {t("cycle.monthly")}
                  </h3>
                  <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                    {details.priceByCycle.monthly.actual.toLocaleString(intl)}{" "}
                    kr.
                    <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                      {t("cycle.perMonthExclVat")}
                    </span>
                  </p>
                  {details.priceByCycle.monthly.actual !==
                    details.priceByCycle.monthly.original && (
                    <p className="text-sm text-gray-400 line-through">
                      {t("cycle.krPerMonth", {
                        price:
                          details.priceByCycle.monthly.original.toLocaleString(
                            intl,
                          ),
                      })}
                    </p>
                  )}
                </div>
                {currentCycle === "monthly" && (
                  <Check className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                )}
              </div>
              {currentCycle !== "monthly" && (
                <button
                  type="button"
                  onClick={() => handleChangePlan("monthly")}
                  disabled={changePlanMutation.isPending}
                  className="mt-4 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  {t("switch.toMonthly")}
                </button>
              )}
            </div>

            {/* Yearly */}
            <div
              className={`relative rounded-lg border-2 p-5 transition-colors ${
                currentCycle === "yearly"
                  ? "border-brand-600 bg-brand-50/50 dark:bg-tt-gran-lys"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <div className="absolute -top-3 right-4">
                <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2.5 py-0.5 text-xs font-semibold text-green-800 dark:text-green-400">
                  {t("cycle.twoMonthsFree")}
                </span>
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">
                    {t("cycle.yearly")}
                  </h3>
                  <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                    {details.priceByCycle.yearly.actual.toLocaleString(intl)}{" "}
                    kr.
                    <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                      {t("cycle.perYearExclVat")}
                    </span>
                  </p>
                  {details.priceByCycle.yearly.actual !==
                    details.priceByCycle.yearly.original && (
                    <p className="text-sm text-gray-400 line-through">
                      {t("cycle.krPerYear", {
                        price:
                          details.priceByCycle.yearly.original.toLocaleString(
                            intl,
                          ),
                      })}
                    </p>
                  )}
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("switch.equivalent", {
                      price: (
                        details.priceByCycle.yearly.actual / 12
                      ).toLocaleString(intl, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }),
                    })}
                  </p>
                </div>
                {currentCycle === "yearly" && (
                  <Check className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                )}
              </div>
              {currentCycle !== "yearly" && (
                <button
                  type="button"
                  onClick={() => handleChangePlan("yearly")}
                  disabled={changePlanMutation.isPending}
                  className="mt-4 w-full rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
                >
                  {t("switch.toYearly")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cancel / Reactivate */}
      {details.aluntaSubscriptionId &&
        !details.cancelAtPeriodEnd &&
        details.status !== "canceled" && (
          <div
            id="annuller"
            className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
          >
            <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
              {t("cancel.title")}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("cancel.description")}
            </p>
            <button
              type="button"
              onClick={() => setShowCancelModal(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-transparent px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              {t("cancel.title")}
            </button>
          </div>
        )}

      {/* Cancel Confirmation Modal */}
      <Modal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        title={t("cancel.title")}
        size="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400 mt-0.5" />
            <div className="text-sm text-yellow-800 dark:text-yellow-300">
              <p className="font-medium">{t("cancel.areYouSure")}</p>
              <p className="mt-1">
                {details.currentPeriodEnd
                  ? t("cancel.activeUntil", {
                      date: dates.long(details.currentPeriodEnd),
                    })
                  : t("cancel.activeUntilEnd")}
              </p>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setShowCancelModal(false)}
              className="w-full sm:w-auto px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              {t("cancel.keep")}
            </button>
            <button
              type="button"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="w-full sm:w-auto px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelMutation.isPending
                ? t("cancel.canceling")
                : t("cancel.confirm")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
