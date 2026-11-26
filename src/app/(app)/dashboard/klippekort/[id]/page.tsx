"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle,
  Clock,
  Copy,
  DollarSign,
  Eye,
  EyeOff,
  Minus,
  Pencil,
  Plus,
  Ticket,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { use, useState } from "react";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/dashboard-nav";
import { AssignEntriesModal } from "@/components/klippekort/AssignEntriesModal";
import {
  KlippekortHuller,
  type KlippekortTone,
} from "@/components/klippekort/KlippekortHuller";
import { PrepaidForecast } from "@/components/klippekort/PrepaidForecast";
import { UsageExport } from "@/components/klippekort/UsageExport";
import { ConfirmDialog, ModuleDisabledState } from "@/components/ui";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { usePermission } from "@/hooks/usePermission";
import { toIntlLocale } from "@/i18n/format-locale";
import { activeDemoCurrency, isDemoMode } from "@/lib/demo/demo-mode";
import { formatCurrency, formatTime } from "@/lib/format";
import { isModuleDisabledError } from "@/lib/modules/forbidden-error";
import { prepaidBalanceLevel } from "@/lib/prepaid/balance";
import { formatPrepaidExpiry } from "@/lib/prepaid/expiry";
import {
  maxPrepaidDeductionHours,
  normalizePrepaidDeductionHours,
  roundPrepaidHours,
} from "@/lib/prepaid/hours";
import {
  sortUsageByDisplayDate,
  usageDisplayDate,
} from "@/lib/prepaid/usage-view";
import { trpc } from "@/providers/trpc-provider";

export default function PackageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations("klippekort");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [showDeductModal, setShowDeductModal] = useState(false);
  const [deductHours, setDeductHours] = useState("");
  const [deductDescription, setDeductDescription] = useState("");
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpHours, setTopUpHours] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);

  const {
    data: pkg,
    isLoading,
    isError,
    error: pkgError,
    refetch,
  } = trpc.prepaid.getById.useQuery({ id });
  const setRenewalMutation = trpc.prepaid.setRenewal.useMutation({
    onSuccess: () => {
      refetch();
      toast.success(t("detail.renewalUpdated"));
    },
    onError: (e) => toast.error(e.message),
  });
  const utils = trpc.useUtils();
  const toggleActiveMutation = trpc.prepaid.toggleActive.useMutation({
    onSuccess: () => {
      // router.refresh() rører ikke tRPC-cachen — siden viste den gamle
      // status indtil en hård genindlæsning. Refetch + invalidér listen.
      refetch();
      utils.prepaid.list.invalidate();
      toast.success(
        pkg?.isActive ? t("detail.deactivated") : t("detail.activated"),
      );
    },
    onError: (error) => toast.error(error.message || t("detail.updateFailed")),
  });
  const { canWrite: canManage } = usePermission("klippekort");

  const deleteMutation = trpc.prepaid.delete.useMutation({
    onSuccess: () => {
      utils.prepaid.list.invalidate();
      router.push("/dashboard/klippekort");
    },
  });
  const manualDeductMutation = trpc.prepaid.manualDeduct.useMutation({
    onSuccess: () => {
      toast.success(t("detail.deducted"));
      setShowDeductModal(false);
      setDeductHours("");
      setDeductDescription("");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || t("detail.deductFailed"));
    },
  });

  const topUpMutation = trpc.prepaid.topUp.useMutation({
    onSuccess: () => {
      toast.success(t("detail.toppedUp"));
      setShowTopUpModal(false);
      setTopUpHours("");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || t("detail.topUpFailed"));
    },
  });

  const setAutoDeductMutation = trpc.prepaid.setAutoDeduct.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.autoDeduct
          ? t("detail.autoDeductOn")
          : t("detail.autoDeductOff"),
      );
      refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const duplicateMutation = trpc.prepaid.duplicate.useMutation({
    onSuccess: (result) => {
      toast.success(t("detail.duplicated"));
      router.push(`/dashboard/klippekort/${result.id}`);
    },
    onError: (error) => {
      toast.error(error.message || t("detail.duplicateFailed"));
    },
  });

  const handleTopUp = async () => {
    const hours = Number.parseFloat(topUpHours);
    if (Number.isNaN(hours) || hours <= 0) {
      toast.error(t("detail.invalidHours"));
      return;
    }
    try {
      await topUpMutation.mutateAsync({
        packageId: id,
        hours,
      });
    } catch {
      // Fejlen vises af mutationens onError.
    }
  };

  const portalVisibilityMutation = trpc.prepaid.setPortalVisibility.useMutation(
    {
      onSuccess: (data) => {
        refetch();
        utils.prepaid.list.invalidate();
        toast.success(
          data.hiddenFromPortal
            ? t("detail.hiddenFromPortal")
            : t("detail.shownInPortal"),
        );
      },
      onError: (error) =>
        toast.error(error.message || t("detail.visibilityFailed")),
    },
  );

  const handleToggleActive = () => {
    toggleActiveMutation.mutate({ id });
  };

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  if (isLoading) {
    return <LoadingScreen message={t("detail.loading")} />;
  }

  if (!pkg) {
    if (isModuleDisabledError(pkgError)) {
      return <ModuleDisabledState />;
    }
    return (
      <div className="py-12 text-center">
        <p className="text-gray-600 dark:text-gray-400">
          {isError ? t("detail.loadFailed") : t("detail.notFound")}
        </p>
        {isError && (
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            {t("detail.retry")}
          </button>
        )}
        <Link
          href="/dashboard/klippekort"
          className="mt-4 inline-flex items-center gap-2 text-brand-600 dark:text-brand-400"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("detail.back")}
        </Link>
      </div>
    );
  }

  const totalHours = parseFloat(pkg.totalHours || "0");
  const usedHours = parseFloat(pkg.usedHours || "0");
  const remainingHours = parseFloat(pkg.remainingHours || "0");
  const manualDeductMax =
    pkg.overdraftPolicy === "allow"
      ? undefined
      : maxPrepaidDeductionHours(remainingHours, pkg.clipSizeMinutes);
  const exceedsManualDeductMax =
    manualDeductMax !== undefined && Number(deductHours) > manualDeductMax;
  const manualDeductEmpty =
    manualDeductMax !== undefined && manualDeductMax <= 0;
  const manualDeductOverdraft =
    pkg.overdraftPolicy === "allow" &&
    Number(deductHours) > 0 &&
    normalizePrepaidDeductionHours(Number(deductHours), pkg.clipSizeMinutes) >
      roundPrepaidHours(remainingHours);
  const hourlyRate = parseFloat(pkg.hourlyRate);
  const hideValue = pkg.hideValue;
  const percentage = totalHours > 0 ? (usedHours / totalHours) * 100 : 0;
  // Forbrugshistorik sorteres efter tidspostens egen dato, ikke efter hvornår
  // trækket blev registreret — ellers ligner en bulk-overførsel ét stort
  // træk på importdagen. Manuelle træk har kun createdAt.
  const usageHistory = sortUsageByDisplayDate(pkg.usageHistory ?? []).map(
    (usage) => ({ ...usage, usageDate: usageDisplayDate(usage) }),
  );

  const handleManualDeduct = async () => {
    if (exceedsManualDeductMax) return;
    const hours = Number(deductHours);
    if (Number.isNaN(hours) || hours <= 0) {
      toast.error(t("detail.invalidHours"));
      return;
    }
    if (!deductDescription.trim()) {
      toast.error(t("detail.enterDescription"));
      return;
    }
    try {
      await manualDeductMutation.mutateAsync({
        packageId: id,
        hours,
        description: deductDescription.trim(),
      });
    } catch {
      // Fejlen vises af mutationens onError.
    }
  };

  // Samme tone-regler som i klippekort-oversigten.
  const hulTone: KlippekortTone =
    percentage >= 90 ? "tom" : percentage >= 75 ? "lav" : "normal";

  const overdraftHours = parseFloat(pkg.overdraftHours || "0");

  const getStatusBadge = () => {
    // Overtræk (#93) trumfer alt — kunden skylder timer
    if (overdraftHours > 0) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 dark:bg-red-900/20 px-3 py-1 text-sm font-medium text-red-700 dark:text-red-400">
          <AlertTriangle className="h-4 w-4" />
          {t("detail.overdraft", { hours: overdraftHours.toFixed(1) })}
        </span>
      );
    }
    if (remainingHours <= 0) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 dark:bg-red-900/20 px-3 py-1 text-sm font-medium text-red-700 dark:text-red-400">
          <XCircle className="h-4 w-4" />
          {t("detail.depleted")}
        </span>
      );
    }
    if (prepaidBalanceLevel(remainingHours, totalHours) !== "ok") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/20 px-3 py-1 text-sm font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          {t("detail.lowBalance")}
        </span>
      );
    }
    if (pkg.isActive) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 dark:bg-green-900/20 px-3 py-1 text-sm font-medium text-green-700 dark:text-green-400">
          <CheckCircle className="h-4 w-4" />
          {t("detail.active")}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-700 px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300">
        {t("detail.inactive")}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <Breadcrumbs
          items={[
            { label: t("detail.breadcrumb"), href: "/dashboard/klippekort" },
            { label: pkg.name },
          ]}
        />

        <div className="mt-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {pkg.name}
            </h1>
            <p className="mt-1 text-gray-600 dark:text-gray-400">
              {(Array.isArray(pkg.client) ? pkg.client[0] : pkg.client)?.name}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {getStatusBadge()}
            {/* Redigeringssiden (navn, timer i alt, pris, udløb) fandtes,
                men havde ingen vej ind fra kortet — kunde A 8/9-2026 */}
            {canManage && (
              <Link
                href={`/dashboard/klippekort/${id}/edit`}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-tt-gran-lys transition-colors"
                title={t("detail.editTitle")}
              >
                <Pencil className="h-4 w-4" />
                {t("detail.edit")}
              </Link>
            )}
            <button
              type="button"
              onClick={() => setShowTopUpModal(true)}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
              title={t("detail.addHoursTitle")}
            >
              <Plus className="h-4 w-4" />
              {t("detail.addHours")}
            </button>
            <button
              type="button"
              onClick={() => setShowAssignModal(true)}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-tt-gran-lys transition-colors"
              title={t("detail.linkTimeTitle")}
            >
              <Ticket className="h-4 w-4" />
              {t("detail.linkTime")}
            </button>
            <button
              type="button"
              onClick={() => duplicateMutation.mutate({ id })}
              disabled={duplicateMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              title={t("detail.duplicateTitle")}
            >
              <Copy className="h-4 w-4" />
              {t("detail.duplicate")}
            </button>
            <button
              type="button"
              onClick={() => setShowDeductModal(true)}
              disabled={!pkg.isActive || manualDeductEmpty}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-tt-gran-lys disabled:opacity-50 transition-colors"
              title={
                !pkg.isActive
                  ? t("detail.notActive")
                  : manualDeductEmpty
                    ? remainingHours > 0
                      ? t("detail.balanceBelowClip")
                      : t("detail.noHoursLeft")
                    : t("detail.deductManually")
              }
            >
              <Minus className="h-4 w-4" />
              {t("detail.deductHours")}
            </button>
            <button
              type="button"
              onClick={handleToggleActive}
              disabled={toggleActiveMutation.isPending}
              title={
                pkg.isActive
                  ? t("detail.toggleTitleActive")
                  : t("detail.toggleTitleInactive")
              }
              className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {toggleActiveMutation.isPending
                ? t("detail.updating")
                : pkg.isActive
                  ? t("detail.deactivate")
                  : t("detail.activate")}
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() =>
                  portalVisibilityMutation.mutate({
                    id,
                    hidden: !pkg.hiddenFromPortal,
                  })
                }
                disabled={portalVisibilityMutation.isPending}
                title={
                  pkg.hiddenFromPortal
                    ? t("detail.portalHiddenTitle")
                    : t("detail.portalShownTitle")
                }
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {pkg.hiddenFromPortal ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
                {pkg.hiddenFromPortal
                  ? t("detail.showToClient")
                  : t("detail.hideFromClient")}
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                {tc("delete")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Overview stats */}
      <div
        className={`grid gap-px bg-gray-200 dark:bg-gray-800 rounded-xl overflow-hidden ${
          hideValue ? "sm:grid-cols-2" : "sm:grid-cols-3"
        }`}
      >
        <div className="bg-white dark:bg-gray-900 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("detail.hoursLeft")}
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {formatTime(remainingHours)}
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t("detail.ofTotal", { time: formatTime(totalHours) })}
          </p>
        </div>

        {!hideValue && (
          <div className="bg-white dark:bg-gray-900 p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t("detail.valueLeft")}
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
              {formatCurrency(remainingHours * hourlyRate)}
            </p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {t("detail.ofTotal", {
                time: formatCurrency(totalHours * hourlyRate),
              })}
            </p>
          </div>
        )}

        <div className="bg-white dark:bg-gray-900 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("detail.consumed")}
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {percentage.toFixed(0)}%
          </p>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t("detail.hoursUsed", { time: formatTime(usedHours) })}
          </p>
        </div>
      </div>

      {/* Details card */}
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-4">
          {t("detail.details")}
        </h2>

        {/* Forbrug som klippekortets huller */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-600 dark:text-gray-400">
              {t("detail.usage")}
            </span>
            <span className="tabular-nums font-semibold text-gray-900 dark:text-white">
              {formatTime(usedHours)} / {formatTime(totalHours)}
            </span>
          </div>
          <KlippekortHuller
            totalHours={totalHours}
            remainingHours={remainingHours}
            tone={hulTone}
            showLabel
          />
        </div>

        <dl className="grid gap-4 sm:grid-cols-2">
          {pkg.description && (
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("detail.description")}
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                {pkg.description}
              </dd>
            </div>
          )}

          {!hideValue && (
            <div>
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <DollarSign className="h-3.5 w-3.5" />
                {t("detail.hourlyRate")}
              </dt>
              <dd className="mt-1 text-sm tabular-nums text-gray-900 dark:text-white">
                {t("detail.rateValue", { rate: hourlyRate.toFixed(0) })}
              </dd>
            </div>
          )}

          {!hideValue && (
            <div>
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <DollarSign className="h-3.5 w-3.5" />
                {t("detail.totalValue")}
              </dt>
              <dd className="mt-1 text-sm tabular-nums text-gray-900 dark:text-white">
                {t("detail.amountKr", {
                  amount: parseFloat(pkg.totalValue).toLocaleString(
                    toIntlLocale(locale),
                  ),
                })}
              </dd>
            </div>
          )}

          {pkg.clipSizeMinutes && (
            <div>
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <Clock className="h-3.5 w-3.5" />
                {t("detail.clipSize")}
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                {t("detail.clipSizeValue", { minutes: pkg.clipSizeMinutes })}
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                  {t("detail.clipSizeHint")}
                </span>
              </dd>
            </div>
          )}

          <div>
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <Calendar className="h-3.5 w-3.5" />
              {t("detail.purchaseDate")}
            </dt>
            <dd className="mt-1 text-sm text-gray-900 dark:text-white">
              {new Date(pkg.purchaseDate).toLocaleDateString(
                toIntlLocale(locale),
              )}
            </dd>
          </div>

          {pkg.expiryDate && (
            <div>
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <Calendar className="h-3.5 w-3.5" />
                {t("detail.expiryDate")}
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                {formatPrepaidExpiry(pkg.expiryDate, {}, toIntlLocale(locale))}
              </dd>
            </div>
          )}

          {pkg.renewalNextAt && (
            <div>
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <Calendar className="h-3.5 w-3.5" />
                {t("detail.nextRenewal")}
              </dt>
              <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                {new Date(pkg.renewalNextAt).toLocaleDateString(
                  toIntlLocale(locale),
                  {
                    timeZone: "Europe/Copenhagen",
                  },
                )}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Auto-træk: forvælger kortet ved ny tidsregistrering på kunden */}
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t("detail.autoDeductTitle")}
        </h2>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={pkg.autoDeduct ?? true}
            disabled={setAutoDeductMutation.isPending}
            onChange={(e) =>
              setAutoDeductMutation.mutate({
                packageId: id,
                autoDeduct: e.target.checked,
              })
            }
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {t("detail.autoDeductHint")}
          </span>
        </label>
      </div>

      {/* Periodisk fornyelse (#79) */}
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t("detail.renewalTitle")}
        </h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          {t("detail.renewalHint")}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={pkg.renewalInterval ?? ""}
            onChange={(e) =>
              setRenewalMutation.mutate({
                packageId: id,
                interval: (e.target.value || null) as
                  | "monthly"
                  | "quarterly"
                  | "yearly"
                  | null,
                rollover: (pkg.renewalRollover as "none" | "carry") ?? "none",
              })
            }
            disabled={setRenewalMutation.isPending}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          >
            <option value="">{t("detail.renewalNone")}</option>
            <option value="monthly">{t("detail.renewalMonthly")}</option>
            <option value="quarterly">{t("detail.renewalQuarterly")}</option>
            <option value="yearly">{t("detail.renewalYearly")}</option>
          </select>
          {pkg.renewalInterval && (
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={pkg.renewalRollover === "carry"}
                onChange={(e) =>
                  setRenewalMutation.mutate({
                    packageId: id,
                    interval: pkg.renewalInterval as
                      | "monthly"
                      | "quarterly"
                      | "yearly",
                    rollover: e.target.checked ? "carry" : "none",
                  })
                }
                disabled={setRenewalMutation.isPending}
                className="h-4 w-4 rounded border-gray-300"
              />
              {t("detail.carryOver")}
            </label>
          )}
        </div>
      </div>

      <PrepaidForecast
        createdAt={pkg.createdAt}
        remainingHours={remainingHours}
        usage={pkg.usageHistory ?? []}
        now={new Date()}
        isActive={pkg.isActive ?? false}
        expiryDate={pkg.expiryDate}
      />

      {/* Usage history */}
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-4">
          {t("detail.history")}
        </h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {t("assignedTimeStaysOnProject")}
        </p>
        <UsageExport
          packageId={pkg.id}
          packageName={pkg.name}
          pdfLanguage={
            isDemoMode()
              ? {
                  locale,
                  title: t("detail.history"),
                  date: t("usagePdf.date"),
                  description: t("usagePdf.description"),
                  hours: t("usagePdf.hours"),
                  value: t("usagePdf.value", {
                    currency: activeDemoCurrency(),
                  }),
                }
              : undefined
          }
          showValue={!hideValue}
          usage={usageHistory.map((u) => ({
            id: u.id,
            date: u.usageDate,
            description:
              u.timeEntry?.description || u.description || "Manuelt træk",
            hoursUsed: u.hoursUsed,
            valueUsed: u.valueUsed,
          }))}
        />

        {usageHistory.length > 0 ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {usageHistory.map((usage) => (
              <div
                key={usage.id}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {usage.timeEntry?.description ||
                      usage.description ||
                      t("detail.timeEntryFallback")}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {usage.timeEntry?.project?.name ||
                      (usage.timeEntry
                        ? t("detail.projectFallback")
                        : t("detail.manualDeduction"))}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {usage.timeEntry
                      ? usage.usageDate.toLocaleDateString(
                          toIntlLocale(locale),
                          {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          },
                        )
                      : usage.usageDate.toLocaleDateString(
                          toIntlLocale(locale),
                          {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                  </p>
                </div>
                <div className="text-right pl-4">
                  <p className="text-sm tabular-nums font-semibold text-gray-900 dark:text-white">
                    -{formatTime(usage.hoursUsed)}
                  </p>
                  {!hideValue && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatCurrency(usage.valueUsed)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Clock className="h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">
              {t("detail.noUsage")}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t("detail.noUsageHint")}
            </p>
          </div>
        )}
      </div>

      {/* Manual Deduct Modal */}
      {showDeductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t("detail.deductModalTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setShowDeductModal(false)}
                className="rounded-lg p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="hours"
                  className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  {t("detail.hoursCount")}{" "}
                  <span className="text-red-600">*</span>
                </label>
                <input
                  id="hours"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={manualDeductMax}
                  value={deductHours}
                  onChange={(e) => setDeductHours(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder={t("detail.hoursPlaceholder")}
                />
                {manualDeductMax !== undefined && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t("detail.maxHours", {
                      time: formatTime(manualDeductMax),
                    })}
                  </p>
                )}
                {manualDeductOverdraft && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    {t("detail.overdraftDeductNote")}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="description"
                  className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  {t("detail.description")}{" "}
                  <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="description"
                  rows={3}
                  value={deductDescription}
                  onChange={(e) => setDeductDescription(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder={t("detail.deductDescriptionPlaceholder")}
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowDeductModal(false)}
                  className="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  {tc("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleManualDeduct}
                  disabled={
                    manualDeductMutation.isPending || exceedsManualDeductMax
                  }
                  className="flex-1 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
                >
                  {manualDeductMutation.isPending
                    ? t("detail.deducting")
                    : t("detail.deductHours")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top-up Modal */}
      {showTopUpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t("detail.topUpModalTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setShowTopUpModal(false)}
                className="rounded-lg p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3 border border-green-100 dark:border-green-900/30">
                <p className="text-sm text-green-800 dark:text-green-300">
                  {t.rich("detail.currentBalance", {
                    remaining: formatTime(remainingHours),
                    total: formatTime(totalHours),
                    b: (chunks) => (
                      <strong className="tabular-nums">{chunks}</strong>
                    ),
                  })}
                </p>
              </div>

              <div>
                <label
                  htmlFor="topUpHours"
                  className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  {t("detail.hoursToAdd")}{" "}
                  <span className="text-red-600">*</span>
                </label>
                <input
                  id="topUpHours"
                  type="number"
                  step="0.5"
                  min="0.5"
                  value={topUpHours}
                  onChange={(e) => setTopUpHours(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm text-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                  placeholder={t("detail.hoursToAddPlaceholder")}
                />
                {topUpHours && parseFloat(topUpHours) > 0 && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {t("detail.newTotal", {
                      value: formatTime(totalHours + parseFloat(topUpHours)),
                    })}
                    {" | "}
                    {t("detail.newBalance", {
                      value: formatTime(
                        remainingHours + parseFloat(topUpHours),
                      ),
                    })}
                    {!hideValue && (
                      <>
                        {" | "}
                        {t("detail.newValue", {
                          value: formatCurrency(
                            (totalHours + parseFloat(topUpHours)) * hourlyRate,
                          ),
                        })}
                      </>
                    )}
                  </p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowTopUpModal(false)}
                  className="flex-1 rounded-lg px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  {tc("cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleTopUp}
                  disabled={topUpMutation.isPending}
                  className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                >
                  {topUpMutation.isPending
                    ? t("detail.adding")
                    : t("detail.addHours")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AssignEntriesModal
        isOpen={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        packageId={id}
        packageName={pkg.name}
        remainingHours={remainingHours}
        clipSizeMinutes={pkg.clipSizeMinutes}
        overdraftPolicy={pkg.overdraftPolicy}
        onAssigned={refetch}
      />

      {/* Kort med forbrug kan ikke slettes (historikken er kundens
          dokumentation). I stedet for en død fejltoast tilbyder dialogen
          "Deaktivér" direkte — det er dét, brugeren reelt vil opnå. */}
      {usageHistory.length > 0 ? (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={() => {
            setShowDeleteConfirm(false);
            // "Slet" på et kort med forbrug = deaktivér + skjul for kunden.
            // Historikken bevares internt.
            if (pkg.isActive) toggleActiveMutation.mutate({ id });
            if (!pkg.hiddenFromPortal)
              portalVisibilityMutation.mutate({ id, hidden: true });
          }}
          title={t("detail.cannotDeleteTitle")}
          description={
            <>
              {t("detail.cannotDeleteBody", { count: usageHistory.length })}
              {pkg.isActive || !pkg.hiddenFromPortal ? (
                <> {t("detail.cannotDeleteInstead")}</>
              ) : (
                <> {t("detail.cannotDeleteAlready")}</>
              )}
            </>
          }
          confirmLabel={
            pkg.isActive || !pkg.hiddenFromPortal
              ? t("detail.deactivateAndHide")
              : t("detail.ok")
          }
          variant={
            pkg.isActive || !pkg.hiddenFromPortal ? "warning" : "default"
          }
          isLoading={
            toggleActiveMutation.isPending || portalVisibilityMutation.isPending
          }
        />
      ) : (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={async () => {
            try {
              await deleteMutation.mutateAsync({ id });
              toast.success(t("detail.deleted"));
              setShowDeleteConfirm(false);
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : t("detail.deleteFailed");
              toast.error(message);
            }
          }}
          title={t("detail.deleteTitle")}
          description={t("detail.deleteDescription")}
          confirmLabel={tc("delete")}
          variant="danger"
          isLoading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
