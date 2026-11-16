"use client";

import { Copy, CreditCard, Loader2, Settings, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

interface UserBillingProps {
  userId: string;
  activeTab: string;
  isAdmin: boolean;
}

function BillingRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-1">
      <span className="w-36 shrink-0 text-gray-500">{label}</span>
      <span className="text-gray-900">{children}</span>
    </div>
  );
}

function CopyableId({ value }: { value: string | null }) {
  const t = useTranslations("adminUsers");
  if (!value) return <span className="text-gray-400">--</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs">
        {value}
      </code>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(value)}
        className="text-gray-400 hover:text-gray-600"
        title={t("billing.copy")}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function SubscriptionStatusBadge({ status }: { status: string }) {
  const t = useTranslations("adminUsers");
  const config: Record<string, { label: string; color: string }> = {
    active: {
      label: t("billing.statusActive"),
      color: "bg-green-100 text-green-800",
    },
    trialing: {
      label: t("billing.statusTrialing"),
      color: "bg-blue-100 text-blue-800",
    },
    past_due: {
      label: t("billing.statusPastDue"),
      color: "bg-yellow-100 text-yellow-800",
    },
    canceled: {
      label: t("billing.statusCanceled"),
      color: "bg-red-100 text-red-800",
    },
  };
  const s = config[status] || {
    label: status,
    color: "bg-gray-100 text-gray-800",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.color}`}
    >
      {s.label}
    </span>
  );
}

export function UserBilling({ userId, activeTab, isAdmin }: UserBillingProps) {
  const t = useTranslations("adminUsers");
  const locale = useLocale();
  const intlLocale = toIntlLocale(locale);
  const [trialDays, setTrialDays] = useState("7");
  const [trialReason, setTrialReason] = useState("");
  const [manualEndDate, setManualEndDate] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const [discountPercent, setDiscountPercent] = useState("");
  const [discountExpiry, setDiscountExpiry] = useState("");

  const utils = trpc.useUtils();

  const { data: billing, refetch: refetchBilling } =
    trpc.admin.getUserBilling.useQuery(
      { userId },
      { enabled: activeTab === "billing" && isAdmin },
    );

  const { data: aluntaDiscounts, isLoading: discountsLoading } =
    trpc.admin.listSubscriptionDiscounts.useQuery(
      { userId },
      { enabled: activeTab === "billing" && isAdmin },
    );

  const deleteDiscountMutation =
    trpc.admin.deleteSubscriptionDiscount.useMutation({
      onSuccess: () => {
        toast.success(t("billing.discountDeleted"));
        utils.admin.listSubscriptionDiscounts.invalidate({ userId });
        utils.admin.getUserBilling.invalidate({ userId });
      },
      onError: (error) => toast.error(error.message),
    });

  const adjustTrialMutation = trpc.admin.adjustUserTrial.useMutation({
    onSuccess: (data) => {
      const dateStr = new Date(data.newTrialEnd).toLocaleDateString(intlLocale);
      toast.success(t("billing.trialAdjusted", { date: dateStr }));
      refetchBilling();
      setTrialDays("7");
      setTrialReason("");
    },
    onError: (error) => toast.error(error.message),
  });

  const setManualSubMutation = trpc.admin.setManualSubscription.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setManualEndDate("");
      setManualReason("");
      refetchBilling();
      utils.admin.getUserBilling.invalidate({ userId });
      utils.admin.listUsers.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const setDiscountMutation = trpc.admin.setSubscriptionDiscount.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      setShowDiscountForm(false);
      setDiscountPercent("");
      setDiscountExpiry("");
      utils.admin.getUserBilling.invalidate({ userId });
    },
    onError: (error) => toast.error(error.message),
  });

  const removeFoundingMutation = trpc.admin.removeFoundingTier.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.admin.getUserBilling.invalidate({ userId });
      utils.admin.listUsers.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  if (activeTab !== "billing" || !isAdmin) return null;

  if (!billing) {
    return (
      <div className="py-8 text-center text-gray-500">
        <Loader2 className="mx-auto h-8 w-8 animate-spin mb-2" />
        <p>{t("billing.loading")}</p>
      </div>
    );
  }

  const manualSubSection = (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        {t("billing.manualTitle")}
      </h3>
      <p className="text-xs text-gray-500 mb-3">{t("billing.manualHint")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor="manual-end-date"
            className="block text-xs text-gray-500 mb-1"
          >
            {t("billing.endDate")}
          </label>
          <input
            id="manual-end-date"
            type="date"
            min={toLocalDateStr(new Date())}
            value={manualEndDate}
            onChange={(e) => setManualEndDate(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label
            htmlFor="manual-reason"
            className="block text-xs text-gray-500 mb-1"
          >
            {t("billing.reasonRequired")}
          </label>
          <input
            id="manual-reason"
            type="text"
            value={manualReason}
            onChange={(e) => setManualReason(e.target.value)}
            placeholder={t("billing.manualPlaceholder")}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() =>
            setManualSubMutation.mutate({
              userId,
              endDate: manualEndDate || null,
              reason: manualReason,
            })
          }
          disabled={setManualSubMutation.isPending || !manualReason.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {setManualSubMutation.isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          )}
          {t("billing.activate")}
        </button>
      </div>
    </div>
  );

  if (!billing.subscription) {
    return (
      <div className="p-4 space-y-6">
        <div className="py-6 text-center text-gray-500">
          <CreditCard className="mx-auto h-10 w-10 mb-2 opacity-50" />
          <p>{t("billing.noSubscription")}</p>
        </div>
        {manualSubSection}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Subscription Details */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          {t("billing.subscription")}
        </h3>
        <div className="grid gap-2 text-sm">
          <BillingRow label={t("billing.status")}>
            <SubscriptionStatusBadge status={billing.subscription.status} />
          </BillingRow>
          <BillingRow label={t("billing.plan")}>
            {billing.subscription.billingCycle === "yearly"
              ? t("billing.yearly")
              : t("billing.monthly")}
          </BillingRow>
          {billing.subscription.isTrial && (
            <BillingRow label={t("billing.trialEnds")}>
              {new Date(billing.subscription.trialEndsAt).toLocaleDateString(
                intlLocale,
              )}
            </BillingRow>
          )}
          {billing.subscription.currentPeriodEnd && (
            <BillingRow label={t("billing.periodEnds")}>
              {new Date(
                billing.subscription.currentPeriodEnd,
              ).toLocaleDateString(intlLocale)}
            </BillingRow>
          )}
          {billing.subscription.cancelAtPeriodEnd && (
            <BillingRow label={t("billing.cancellation")}>
              <span className="text-red-600">{t("billing.cancelsAtEnd")}</span>
            </BillingRow>
          )}
          {billing.subscription.foundingTier && (
            <BillingRow label={t("billing.foundingTier")}>
              <div className="flex items-center gap-2">
                <span className="font-medium text-amber-600">
                  {billing.subscription.discountExpiresAt
                    ? t("billing.foundingUntil", {
                        tier: billing.subscription.foundingTier,
                        percent: billing.subscription.discountPercent ?? 0,
                        date: new Date(
                          billing.subscription.discountExpiresAt,
                        ).toLocaleDateString(intlLocale),
                      })
                    : t("billing.foundingForever", {
                        tier: billing.subscription.foundingTier,
                        percent: billing.subscription.discountPercent ?? 0,
                      })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t("billing.confirm")))
                      removeFoundingMutation.mutate({ userId });
                  }}
                  disabled={removeFoundingMutation.isPending}
                  className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" /> {t("billing.remove")}
                </button>
              </div>
            </BillingRow>
          )}

          <BillingRow label={t("billing.discount")}>
            {!showDiscountForm ? (
              <div className="flex items-center gap-2">
                <span
                  className={
                    (billing.subscription?.discountPercent ?? 0) > 0
                      ? "font-medium text-green-600"
                      : "text-gray-500"
                  }
                >
                  {(billing.subscription?.discountPercent ?? 0) > 0
                    ? billing.subscription?.discountExpiresAt
                      ? t("billing.discountUntil", {
                          percent: billing.subscription?.discountPercent ?? 0,
                          date: new Date(
                            billing.subscription.discountExpiresAt,
                          ).toLocaleDateString(intlLocale),
                        })
                      : t("billing.discountPermanent", {
                          percent: billing.subscription?.discountPercent ?? 0,
                        })
                    : t("billing.noDiscount")}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDiscountPercent(
                      String(billing.subscription?.discountPercent || ""),
                    );
                    setDiscountExpiry(
                      billing.subscription?.discountExpiresAt
                        ? toLocalDateStr(
                            new Date(billing.subscription.discountExpiresAt),
                          )
                        : "",
                    );
                    setShowDiscountForm(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-200"
                >
                  <Settings className="h-3 w-3" /> {t("billing.change")}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={discountPercent}
                    onChange={(e) => setDiscountPercent(e.target.value)}
                    className="w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={discountExpiry}
                    onChange={(e) => setDiscountExpiry(e.target.value)}
                    className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                  />
                  <span className="text-xs text-gray-400">
                    {t("billing.emptyPermanent")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const pct = Number(discountPercent);
                      if (Number.isNaN(pct) || pct < 0 || pct > 100) {
                        toast.error(t("billing.discountRange"));
                        return;
                      }
                      setDiscountMutation.mutate({
                        userId,
                        discountPercent: pct,
                        discountExpiresAt: discountExpiry || null,
                      });
                    }}
                    disabled={setDiscountMutation.isPending}
                    className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {setDiscountMutation.isPending
                      ? t("billing.saving")
                      : t("billing.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDiscountForm(false)}
                    className="rounded-md px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                  >
                    {t("billing.cancel")}
                  </button>
                </div>
              </div>
            )}
          </BillingRow>
          <BillingRow label={t("billing.created")}>
            {new Date(billing.subscription.createdAt).toLocaleDateString(
              intlLocale,
            )}
          </BillingRow>
        </div>
      </div>

      {/* Alunta Discounts */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          {t("billing.aluntaDiscounts")}
        </h3>
        {discountsLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("billing.loadingDiscounts")}
          </div>
        ) : aluntaDiscounts && aluntaDiscounts.length > 0 ? (
          <div className="space-y-2">
            {aluntaDiscounts.map((discount) => (
              <div
                key={discount.uuid}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-gray-900">
                    {discount.discount_name}
                  </span>
                  <span className="text-xs text-gray-500">
                    {discount.end_date
                      ? t("billing.discountDetailUntil", {
                          value:
                            discount.discount_type === "percent"
                              ? `${discount.discount_value}%`
                              : t("billing.amountKr", {
                                  value: discount.discount_value,
                                }),
                          from: new Date(
                            discount.effective_date,
                          ).toLocaleDateString(intlLocale),
                          to: new Date(discount.end_date).toLocaleDateString(
                            intlLocale,
                          ),
                        })
                      : t("billing.discountDetailPermanent", {
                          value:
                            discount.discount_type === "percent"
                              ? `${discount.discount_value}%`
                              : t("billing.amountKr", {
                                  value: discount.discount_value,
                                }),
                          from: new Date(
                            discount.effective_date,
                          ).toLocaleDateString(intlLocale),
                        })}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        t("billing.confirmDeleteDiscount", {
                          name: discount.discount_name,
                        }),
                      )
                    )
                      deleteDiscountMutation.mutate({
                        userId,
                        discountUuid: discount.uuid,
                      });
                  }}
                  disabled={deleteDiscountMutation.isPending}
                  className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" /> {t("billing.delete")}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">{t("billing.noDiscounts")}</p>
        )}
      </div>

      {/* Alunta IDs */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          {t("billing.aluntaIds")}
        </h3>
        <div className="grid gap-2 text-sm">
          <BillingRow label={t("billing.customerId")}>
            <CopyableId value={billing.subscription.aluntaCustomerId} />
          </BillingRow>
          <BillingRow label={t("billing.subscriptionId")}>
            <CopyableId value={billing.subscription.aluntaSubscriptionId} />
          </BillingRow>
        </div>
      </div>

      {/* Køb i appen (App Store / Google Play) */}
      {billing.subscription.storeProvider && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            {t("billing.inApp")}
          </h3>
          <div className="grid gap-2 text-sm">
            <BillingRow label={t("billing.store")}>
              {t(
                billing.subscription.storeManaged
                  ? "billing.storeManaged"
                  : "billing.storeExpired",
                {
                  store:
                    billing.subscription.storeProvider === "google"
                      ? "Google Play"
                      : "App Store",
                },
              )}
            </BillingRow>
            <BillingRow label={t("billing.storeStatus")}>
              {billing.subscription.storeStatus ?? "—"}
            </BillingRow>
            <BillingRow label={t("billing.product")}>
              {billing.subscription.storeProductId ?? "—"}
            </BillingRow>
            <BillingRow label={t("billing.environment")}>
              {billing.subscription.storeEnvironment ?? "—"}
            </BillingRow>
          </div>
        </div>
      )}

      {/* Trial adjustment */}
      {(billing.subscription.isTrial ||
        (billing.subscription.trialEndsAt &&
          new Date(billing.subscription.trialEndsAt) > new Date())) && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            {t("billing.adjustTrial")}
          </h3>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="trial-days"
                className="block text-xs text-gray-500 mb-1"
              >
                {t("billing.days")}
              </label>
              <input
                id="trial-days"
                type="number"
                min="1"
                max="365"
                value={trialDays}
                onChange={(e) => setTrialDays(e.target.value)}
                className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label
                htmlFor="trial-reason"
                className="block text-xs text-gray-500 mb-1"
              >
                {t("billing.reasonRequired")}
              </label>
              <input
                id="trial-reason"
                type="text"
                value={trialReason}
                onChange={(e) => setTrialReason(e.target.value)}
                placeholder={t("billing.trialReasonPlaceholder")}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  adjustTrialMutation.mutate({
                    userId,
                    days: Number.parseInt(trialDays, 10) || 7,
                    reason: trialReason,
                  })
                }
                disabled={adjustTrialMutation.isPending || !trialReason.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adjustTrialMutation.isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                {t("billing.extend")}
              </button>
              <button
                type="button"
                onClick={() =>
                  adjustTrialMutation.mutate({
                    userId,
                    days: -(Number.parseInt(trialDays, 10) || 7),
                    reason: trialReason,
                  })
                }
                disabled={adjustTrialMutation.isPending || !trialReason.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("billing.shorten")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual subscription */}
      {manualSubSection}
    </div>
  );
}
