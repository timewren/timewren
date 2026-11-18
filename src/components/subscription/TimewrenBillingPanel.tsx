"use client";

import { CreditCard, ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { toIntlLocale } from "@/i18n/format-locale";
import type { RouterOutputs } from "@/lib/trpc/routers";
import { trpc } from "@/providers/trpc-provider";

type Overview = Extract<
  RouterOutputs["timewrenBilling"]["overview"],
  { enabled: true }
>;
type Plan = Overview["plans"][number];
type PaidTier = "privat" | "solo" | "team" | "business";

/**
 * Abonnement på TimeWren Cloud: planer i EUR ekskl. moms, Stripe Checkout og
 * kundeportalen (lib/trpc/routers/timewrenBilling.ts). Bruges på
 * abonnementssiden og i onboardingens plantrin. TimeTracks side er uændret.
 */
export function TimewrenBillingPanel({
  returnPath,
  beforeCheckout,
  afterCheckoutCreated,
  onContinueFree,
}: {
  /** Hvor Stripe sender kunden tilbage til (relativ sti under /dashboard). */
  returnPath?: string;
  /** Kaldes før checkout, fx for at oprette Gratis-rækken i onboardingen. */
  beforeCheckout?: () => Promise<unknown>;
  /**
   * Kaldes, når checkout er oprettet, lige før skiftet til Stripe; fx for at
   * afslutte onboardingen. Fejler oprettelsen, kaldes den ikke. En fejl her
   * stopper ikke skiftet til Stripe.
   */
  afterCheckoutCreated?: () => Promise<unknown>;
  /** Vises som knap i onboardingen: fortsæt på Gratis. */
  onContinueFree?: () => void;
}) {
  const t = useTranslations("settingsSubscription.timewren");
  const locale = useLocale();
  const { data, isLoading, isError, refetch, isFetching } =
    trpc.timewrenBilling.overview.useQuery();
  const [pending, setPending] = useState<string | null>(null);
  const [seatDraft, setSeatDraft] = useState<Record<string, number>>({});

  const checkout = trpc.timewrenBilling.checkout.useMutation();
  const portal = trpc.timewrenBilling.portal.useMutation();

  // Fejler opslaget, må hverken betalingen eller "Fortsæt på Gratis" i
  // onboardingen forsvinde uden forklaring.
  if (isError && !data) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t("loadFailed")}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-tt-gran px-4 py-2.5 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-60"
          >
            {t("retry")}
          </button>
          {onContinueFree && (
            <button
              type="button"
              onClick={onContinueFree}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-800 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t("stayFree")}
            </button>
          )}
        </div>
      </div>
    );
  }
  if (isLoading || !data || !data.enabled) return null;

  const eur = (amount: number) =>
    new Intl.NumberFormat(toIntlLocale(locale), {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  const day = (d: Date | string) =>
    new Intl.DateTimeFormat(toIntlLocale(locale), {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(d));

  const { current } = data;
  const planName = (tier: string) => t(`plans.${tier}` as "plans.free");

  const seatsFor = (plan: Plan) =>
    seatDraft[plan.tier] ??
    Math.min(plan.maxUsers, Math.max(plan.minUsers, data.seatsInUse));

  const startCheckout = async (plan: Plan) => {
    setPending(plan.tier);
    try {
      await beforeCheckout?.();
      const result = await checkout.mutateAsync({
        tier: plan.tier as PaidTier,
        seats: plan.perUser ? seatsFor(plan) : undefined,
        returnPath,
      });
      await afterCheckoutCreated?.().catch((error) =>
        console.error("TimeWren checkout: afterCheckoutCreated failed", error),
      );
      window.location.href = result.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setPending(null);
    }
  };

  const openPortal = async () => {
    setPending("portal");
    try {
      const result = await portal.mutateAsync();
      window.location.href = result.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setPending(null);
    }
  };

  const users = (p: Plan) =>
    p.perUser
      ? t("users.range", { min: p.minUsers, max: p.maxUsers })
      : p.maxUsers === 1
        ? t("users.one")
        : t("users.upTo", { n: p.maxUsers });
  const clients = (p: Plan) =>
    p.maxActiveClients === null
      ? t("clients.unlimited")
      : t("clients.upTo", { n: p.maxActiveClients });

  const card =
    "rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900";
  const primary =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-tt-gran px-4 py-2.5 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-60";
  const secondary =
    "inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-800 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-60";

  return (
    <div className="space-y-4">
      {!onContinueFree && (
        <section className={`${card} p-6`} aria-labelledby="tw-current">
          <h2
            id="tw-current"
            className="text-sm font-medium text-gray-500 dark:text-gray-400"
          >
            {t("currentTitle")}
          </h2>
          <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
            {t("currentPlan", { plan: planName(current.tier) })}
            {!current.isFree && current.seatCount > 1 && (
              <span className="ml-2 text-base font-normal text-gray-600 dark:text-gray-400">
                {t("seatCount", { count: current.seatCount })}
              </span>
            )}
          </p>
          <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
            {current.isFree && <p>{t("freeNote")}</p>}
            {current.status === "past_due" && (
              <p className="font-medium text-red-700 dark:text-red-400">
                {t("pastDue")}
              </p>
            )}
            {current.trialEndsAt && (
              <p>{t("trialEnds", { date: day(current.trialEndsAt) })}</p>
            )}
            {!current.isFree &&
              current.currentPeriodEnd &&
              !current.trialEndsAt && (
                <p>
                  {current.cancelAtPeriodEnd
                    ? t("endsOn", { date: day(current.currentPeriodEnd) })
                    : t("renews", { date: day(current.currentPeriodEnd) })}
                </p>
              )}
          </div>
          {current.canOpenPortal && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={openPortal}
                disabled={pending !== null}
                className={current.hasLiveSubscription ? primary : secondary}
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
                {t("manage")}
              </button>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("manageHint")}
              </p>
            </div>
          )}
        </section>
      )}

      {!current.hasLiveSubscription && (
        <section className={`${card} p-6`} aria-labelledby="tw-plans">
          <h2
            id="tw-plans"
            className="text-lg font-semibold text-gray-900 dark:text-white"
          >
            {t("chooseTitle")}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t("chooseLead")}
          </p>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {data.plans
              .filter((p) => p.tier !== "free")
              .map((plan) => {
                const withTrial = data.trialEligible && plan.tier !== "privat";
                const seats = seatsFor(plan);
                return (
                  <li
                    key={plan.tier}
                    className="flex flex-col rounded-lg border border-gray-200 dark:border-gray-800 p-4"
                  >
                    <h3 className="font-medium text-gray-900 dark:text-white">
                      {planName(plan.tier)}
                    </h3>
                    <p className="mt-1">
                      <span className="text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
                        {eur(plan.priceEur)}
                      </span>{" "}
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {plan.perUser ? t("perUserMonth") : t("perMonth")},{" "}
                        {t("exclVat")}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                      {users(plan)}. {clients(plan)}.
                    </p>
                    {plan.perUser && (
                      <label className="mt-3 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        {t("seatsLabel")}
                        <input
                          type="number"
                          inputMode="numeric"
                          min={plan.minUsers}
                          max={plan.maxUsers}
                          value={seats}
                          onChange={(e) => {
                            const n = Number.parseInt(e.target.value, 10);
                            if (Number.isFinite(n)) {
                              setSeatDraft((s) => ({ ...s, [plan.tier]: n }));
                            }
                          }}
                          onBlur={() =>
                            setSeatDraft((s) => ({
                              ...s,
                              [plan.tier]: Math.min(
                                plan.maxUsers,
                                Math.max(plan.minUsers, seats),
                              ),
                            }))
                          }
                          className="w-20 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 tabular-nums"
                        />
                      </label>
                    )}
                    <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                      {withTrial
                        ? t("trial", { days: data.trialDays })
                        : t("noTrial")}
                    </p>
                    <button
                      type="button"
                      onClick={() => startCheckout(plan)}
                      disabled={pending !== null}
                      className={`${primary} mt-3`}
                    >
                      <CreditCard className="h-4 w-4" aria-hidden />
                      {t("choose", { plan: planName(plan.tier) })}
                    </button>
                  </li>
                );
              })}
          </ul>
          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            {t("securePayment")}
          </p>
          {onContinueFree && (
            <div className="mt-4">
              <button
                type="button"
                onClick={onContinueFree}
                disabled={pending !== null}
                className={secondary}
              >
                {t("stayFree")}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
