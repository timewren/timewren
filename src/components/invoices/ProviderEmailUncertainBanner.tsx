"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";

const PROVIDERS = [
  { key: "billy", name: "Billy" },
  { key: "dinero", name: "Dinero" },
] as const;

/**
 * Shown when Billy/Dinero may have mailed the invoice but never confirmed it
 * (timeout, network error). Sending is blocked until the user has checked
 * the accounting system and tells TimeTrack what they found.
 */
export function ProviderEmailUncertainBanner({
  invoiceId,
}: {
  invoiceId: string;
}) {
  const t = useTranslations("invoices");
  const utils = trpc.useUtils();
  const { data } = trpc.invoices.providerEmailState.useQuery({
    id: invoiceId,
  });
  const resolve = trpc.invoices.resolveProviderEmail.useMutation({
    onSuccess: () => {
      toast.success(t("providerEmail.resolved"));
      void utils.invoices.providerEmailState.invalidate({ id: invoiceId });
      void utils.invoices.sendPreview.invalidate({ id: invoiceId });
    },
    onError: (error) => toast.error(error.message),
  });

  const uncertain = PROVIDERS.filter(({ key }) => data?.[key] === "uncertain");
  if (uncertain.length === 0) return null;

  return (
    <>
      {uncertain.map(({ key, name }) => (
        <div
          key={key}
          role="alert"
          className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-400"
        >
          <p className="font-medium">
            <AlertTriangle className="mr-2 inline-block h-4 w-4" />
            {t("providerEmail.uncertainTitle", { provider: name })}
          </p>
          <p className="mt-1">
            {t("providerEmail.uncertainBody", { provider: name })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={resolve.isPending}
              onClick={() =>
                resolve.mutate({ id: invoiceId, provider: key, wasSent: true })
              }
              className="rounded-lg border border-warning-300 bg-white px-3 py-1.5 font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-warning-700 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800"
            >
              {t("providerEmail.wasSent", { provider: name })}
            </button>
            <button
              type="button"
              disabled={resolve.isPending}
              onClick={() =>
                resolve.mutate({ id: invoiceId, provider: key, wasSent: false })
              }
              className="rounded-lg border border-warning-300 bg-white px-3 py-1.5 font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-warning-700 dark:bg-gray-900 dark:text-white dark:hover:bg-gray-800"
            >
              {t("providerEmail.notSent", { provider: name })}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
