"use client";

import { Bot, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { ConfirmDialog } from "@/components/ui";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { translateScope } from "@/lib/auth/mcp-oauth-query";
import { trpc } from "@/providers/trpc-provider";

function fmtDate(
  value: Date | string | null | undefined,
  locale: string,
): string | null {
  return value
    ? new Date(value).toLocaleDateString(toIntlLocale(locale))
    : null;
}

/**
 * Forbundne AI-apps (#912): Claude, ChatGPT m.fl., der er forbundet til
 * TimeTrack med OAuth. Viser organisation, adgang og sidst brugt, og lader
 * brugeren afbryde forbindelsen (tokens tilbagekaldes med det samme).
 */
export function ConnectedAiAppsSection() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("settingsAiApps");
  const tAuth = useTranslations("auth");
  const locale = useLocale();
  const utils = trpc.useUtils();
  const { data: apps, isLoading } = trpc.connectedApps.list.useQuery();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const revoke = trpc.connectedApps.revoke.useMutation({
    onSuccess: () => {
      utils.connectedApps.list.invalidate();
      toast.success(t("revoked"));
    },
    onError: (err) => toast.error(err.message),
  });
  const pending = apps?.find((a) => a.id === confirmId);

  return (
    <div
      id="ai-apps"
      className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
    >
      <div className="mb-6 flex items-start gap-4">
        <div className="h-12 w-12 rounded-lg bg-tt-gran flex items-center justify-center shrink-0">
          <Bot className="h-6 w-6 text-tt-paa-gran" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t("intro", { brand: brand.name })}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <InlineSpinner className="h-6 w-6" />
        </div>
      ) : apps && apps.length > 0 ? (
        <div className="space-y-2">
          {apps.map((app) => (
            <div
              key={app.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {app.clientName || t("defaultName")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {app.organizationName && <>{app.organizationName} • </>}
                  {t("connected", {
                    date: fmtDate(app.createdAt, locale) ?? t("unknownDate"),
                  })}
                  {app.lastUsedAt && (
                    <>
                      {" "}
                      •{" "}
                      {t("lastUsed", {
                        date: fmtDate(app.lastUsedAt, locale) ?? "",
                      })}
                    </>
                  )}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {app.scopes
                    .filter((s) => s !== "offline_access")
                    .map((scope) => translateScope(scope, tAuth))
                    .join(", ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmId(app.id)}
                disabled={revoke.isPending}
                className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                title={t("disconnectTitle")}
                aria-label={t("disconnectApp", {
                  name: app.clientName || t("defaultName"),
                })}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{t("none")}</p>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId) revoke.mutate({ id: confirmId });
          setConfirmId(null);
        }}
        title={t("confirmTitle")}
        description={t("confirmText", {
          name: pending?.clientName || t("appFallback"),
          brand: brand.name,
        })}
        confirmLabel={t("confirmLabel")}
        variant="danger"
      />
    </div>
  );
}
