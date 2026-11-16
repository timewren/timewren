"use client";

import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Laptop,
  Monitor,
  Shield,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { PageHeader } from "@/components/dashboard-nav";
import { DesktopDownloadButtons } from "@/components/desktop/DesktopDownloadButtons";
import { ConfirmDialog } from "@/components/ui";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

// --- Helpers ---

type Translator = ReturnType<typeof useTranslations>;

function relativeTime(
  date: Date | string | null | undefined,
  t: Translator,
): string {
  if (!date) return t("relNever");
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("relNow");
  if (mins < 60) return t("relMinutes", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("relHours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("relDays", { count: days });
  const months = Math.floor(days / 30);
  return t("relMonths", { count: months });
}

function maskLicenseKey(key: string): string {
  // TT-XXXX-XXXX-XXXX-YYYY -> TT-****-****-****-YYYY
  const parts = key.split("-");
  if (parts.length < 2) return key;
  const last = parts[parts.length - 1];
  const masked = parts.slice(0, -1).map((p, i) => (i === 0 ? p : "****"));
  return [...masked, last].join("-");
}

function OsIcon({ os }: { os: string | null | undefined }) {
  const t = useTranslations("settingsDesktop");
  // Simple text-based OS indicator
  if (
    os?.toLowerCase().includes("mac") ||
    os?.toLowerCase().includes("darwin")
  ) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        <Laptop className="h-3.5 w-3.5" />
        macOS
      </span>
    );
  }
  if (os?.toLowerCase().includes("win")) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        <Monitor className="h-3.5 w-3.5" />
        Windows
      </span>
    );
  }
  if (os?.toLowerCase().includes("linux")) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
        <Monitor className="h-3.5 w-3.5" />
        Linux
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
      <Monitor className="h-3.5 w-3.5" />
      {os || t("osUnknown")}
    </span>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const t = useTranslations("settingsDesktop");
  const config: Record<string, { label: string; className: string }> = {
    lifetime: {
      label: t("tierLifetime"),
      className:
        "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    },
    solo: {
      label: t("tierSolo"),
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    },
    team: {
      label: t("tierTeam"),
      className:
        "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    },
  };
  const c = config[tier] ?? {
    label: tier,
    className: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${c.className}`}
    >
      {c.label}
    </span>
  );
}

// --- Page ---

export default function DesktopSettingsPage() {
  const t = useTranslations("settingsDesktop");
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const locale = useLocale();
  const utils = trpc.useUtils();

  const { data: devices, isLoading: devicesLoading } =
    trpc.desktop.devices.useQuery();
  const { data: license, isLoading: licenseLoading } =
    trpc.desktop.license.useQuery();
  const { data: billing } = trpc.desktop.myLicenseBilling.useQuery();

  const removeDeviceMutation = trpc.desktop.removeDevice.useMutation({
    onSuccess: () => {
      utils.desktop.devices.invalidate();
      toast.success(t("deviceRemoved"));
    },
    onError: () => {
      toast.error(t("deviceRemoveFailed"));
    },
  });

  const refundMutation = trpc.desktop.refundOwnLicense.useMutation({
    onSuccess: () => {
      utils.desktop.license.invalidate();
      utils.desktop.myLicenseBilling.invalidate();
      toast.success(t("refundStarted"));
    },
    onError: (err) => toast.error(err.message),
  });

  const [deviceToRemove, setDeviceToRemove] = useState<string | null>(null);
  const [showRefund, setShowRefund] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const isLoading = devicesLoading || licenseLoading;
  const hasDevices = devices && devices.length > 0;

  if (isLoading) return <LoadingScreen />;

  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(true);
      toast.success(t("keyCopied"));
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      {/* Sektion 1: Download & Opsætning */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t("downloadSetup")}
        </h2>

        {!hasDevices ? (
          /* No devices — big CTA card */
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-brand-50 dark:bg-tt-gran-lys p-8">
            <div className="flex flex-col items-center text-center max-w-lg mx-auto">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-100 dark:bg-tt-gran-lys">
                <Laptop className="h-8 w-8 text-brand-600 dark:text-brand-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                {t("downloadTitle", { brand: brand.name })}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                {t("downloadIntro")}
              </p>

              {/* Feature highlights */}
              <div className="grid grid-cols-2 gap-3 mb-6 w-full text-left">
                {[
                  {
                    icon: Sparkles,
                    text: t("featureAutoTracking"),
                  },
                  {
                    icon: Sparkles,
                    text: t("featureAi"),
                  },
                  {
                    icon: Shield,
                    text: t("featureLocal"),
                  },
                  {
                    icon: WifiOff,
                    text: t("featureOffline"),
                  },
                ].map((feature) => (
                  <div
                    key={feature.text}
                    className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <feature.icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-500 dark:text-brand-400" />
                    <span>{feature.text}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col items-center gap-2">
                <DesktopDownloadButtons size="md" />
                <a
                  href="/download"
                  className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("allDownloads")}
                </a>
              </div>

              <p className="mt-4 text-xs text-gray-500 dark:text-gray-500">
                {t("alreadyInstalled")}{" "}
                <a
                  href="/download#connect"
                  className="text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 underline"
                >
                  {t("connectApp")}
                </a>
              </p>
            </div>
          </div>
        ) : (
          /* Has devices — compact connected status */
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                  <Wifi className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {t("connected")}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                      {t("connectedBadge")}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t("deviceCount", { count: devices.length })}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <DesktopDownloadButtons />
                <a
                  href="/download"
                  className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("allVersions")}
                </a>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Sektion 2: Tilsluttede enheder */}
      <section id="enheder">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t("devicesTitle")}
        </h2>

        {!hasDevices ? (
          <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-8 text-center">
            <Monitor className="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500 mb-2" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("devicesEmpty")}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {t("devicesEmptyHelp")}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t("colDevice")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t("colSystem")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t("colLastSync")}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t("colActions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50 bg-white dark:bg-gray-900">
                {devices.map((device) => (
                  <tr key={device.id}>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Laptop className="h-4 w-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          {device.deviceName || t("unnamedDevice")}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <OsIcon os={device.os} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {relativeTime(device.lastSyncAt, t)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDeviceToRemove(device.id)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t("remove")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sektion 3: Licens */}
      <section id="licens">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          {t("licenseTitle")}
        </h2>

        {!license ? (
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <div className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                <Check className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                {t("includedTitle")}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                {t("includedText", { brand: brand.name })}
              </p>
              <a
                href="/download"
                className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                {t("downloadApp")}
              </a>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 divide-y divide-gray-100 dark:divide-gray-800/50">
            {/* License key */}
            <div className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("licenseKey")}
                </p>
                <p className="mt-0.5 font-mono text-sm text-gray-900 dark:text-white">
                  {maskLicenseKey(license.licenseKey)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleCopyKey(license.licenseKey)}
                className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
              >
                {copiedKey ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-green-500" />
                    {t("copied")}
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    {t("copy")}
                  </>
                )}
              </button>
            </div>

            {/* Tier */}
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t("plan")}
              </p>
              <TierBadge tier={license.tier} />
            </div>

            {/* Status */}
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t("status")}
              </p>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  license.isActive
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                }`}
              >
                {license.isActive ? t("active") : t("inactive")}
              </span>
            </div>

            {/* Device usage */}
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {t("devicesUsed")}
              </p>
              <span className="text-sm text-gray-900 dark:text-white">
                {t("devicesUsedValue", {
                  used: devices?.length ?? 0,
                  max: license.maxDevices,
                })}
              </span>
            </div>

            {/* Expiry (for subscriptions) */}
            {license.expiresAt && (
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("expires")}
                </p>
                <span className="text-sm text-gray-900 dark:text-white">
                  {new Date(license.expiresAt).toLocaleDateString(
                    toIntlLocale(locale),
                  )}
                </span>
              </div>
            )}

            {/* Invoice */}
            {billing?.invoiceUrl && (
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t("invoice")}
                </p>
                <a
                  href={billing.invoiceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("getInvoice")}
                </a>
              </div>
            )}

            {/* Self-service refund within the money-back window */}
            {billing?.refundable && (
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {t("undoPurchase")}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {t("refundWindow")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRefund(true)}
                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20 transition-colors"
                >
                  {t("requestRefund")}
                </button>
              </div>
            )}

            {/* Link to pricing */}
            <div className="px-4 py-3">
              <a
                href="/pricing"
                className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 dark:text-brand-400"
              >
                <ExternalLink className="h-3 w-3" />
                {t("allPlans")}
              </a>
            </div>
          </div>
        )}
      </section>

      {/* Confirm remove device dialog */}
      <ConfirmDialog
        isOpen={!!deviceToRemove}
        onClose={() => setDeviceToRemove(null)}
        onConfirm={() => {
          if (deviceToRemove) {
            removeDeviceMutation.mutate({ deviceId: deviceToRemove });
            setDeviceToRemove(null);
          }
        }}
        title={t("removeDeviceTitle")}
        description={t("removeDeviceText")}
        confirmLabel={t("removeDeviceConfirm")}
        variant="danger"
      />

      {/* Confirm refund dialog */}
      <ConfirmDialog
        isOpen={showRefund}
        onClose={() => setShowRefund(false)}
        onConfirm={() => {
          refundMutation.mutate();
          setShowRefund(false);
        }}
        title={t("requestRefund")}
        description={t("refundText")}
        confirmLabel={t("refundConfirm")}
        variant="danger"
      />
    </div>
  );
}
