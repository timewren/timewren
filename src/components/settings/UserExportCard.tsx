"use client";

import { UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { useActiveOrganization, useListOrganizations } from "@/lib/auth-client";
import { trpc } from "@/providers/trpc-provider";
import {
  ExportHistoryList,
  focusRing,
  isExportBusy,
} from "./ExportHistoryList";

/**
 * "Hent dine egne data" (GDPR artikel 15 og 20): én ZIP-fil med det, der
 * hører til brugeren selv. Synligt for alle roller, også medarbejdere, under
 * Indstillinger > Import og eksport. Hvad der er med, står i
 * src/lib/export/org-export/user-registry.ts.
 */
export function UserExportCard() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("settingsData.user");
  const tx = useTranslations("settingsData.exports");
  const utils = trpc.useUtils();
  const { data: activeOrg } = useActiveOrganization();
  const { data: orgs } = useListOrganizations();
  const inSeveralOrgs = (orgs?.length ?? 0) > 1;

  const { data: flags } = trpc.dataExport.getExportFlags.useQuery();
  const fullExportEnabled = flags?.fullExportEnabled ?? true;

  const { data: exports } = trpc.dataExport.listUserExports.useQuery(
    undefined,
    {
      enabled: fullExportEnabled,
      refetchInterval: (query) =>
        isExportBusy(query.state.data) ? 10_000 : false,
    },
  );

  const request = trpc.dataExport.requestUserExport.useMutation({
    onSuccess: () => {
      toast.success(tx("ordered"));
      utils.dataExport.listUserExports.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const cancel = trpc.dataExport.cancelExportRequest.useMutation({
    onSuccess: () => {
      toast.success(tx("cancelled"));
      utils.dataExport.listUserExports.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const busy = isExportBusy(exports);

  return (
    <section
      aria-labelledby="user-export-heading"
      className="rounded-xl border border-gray-200/80 bg-white p-5 sm:p-6 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-tt-gran-lys">
          <UserRound
            aria-hidden="true"
            strokeWidth={1.5}
            className="h-5 w-5 text-brand-700 dark:text-brand-300"
          />
        </div>
        <div className="min-w-0">
          <h2
            id="user-export-heading"
            className="text-base font-semibold text-gray-900 dark:text-white"
          >
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t("intro")}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 text-sm text-gray-700 sm:grid-cols-2 dark:text-gray-300">
        <div>
          <h3 className="font-medium text-gray-900 dark:text-white">
            {tx("includedHeading")}
          </h3>
          <p className="mt-1.5 leading-relaxed">{t("included")}</p>
        </div>
        <div>
          <h3 className="font-medium text-gray-900 dark:text-white">
            {t("notIncludedHeading")}
          </h3>
          <p className="mt-1.5 leading-relaxed">{t("notIncluded")}</p>
        </div>
      </div>

      <p className="mt-5 text-sm text-gray-600 dark:text-gray-400">
        {activeOrg?.name ? (
          <>
            {t.rich("scopeOrg", {
              org: activeOrg.name,
              b: (chunks) => (
                <span className="font-medium text-gray-900 dark:text-white">
                  {chunks}
                </span>
              ),
            })}
            {inSeveralOrgs ? ` ${t("scopeSeveral")}` : ""}{" "}
          </>
        ) : null}
        {t("buildNote", { brand: brand.name })}
      </p>

      {fullExportEnabled ? (
        <>
          <div className="mt-5">
            <button
              type="button"
              onClick={() => request.mutate()}
              disabled={request.isPending || busy}
              className={`inline-flex min-h-11 items-center gap-2 rounded-lg bg-tt-gran px-5 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-10 dark:text-gray-950 ${focusRing}`}
            >
              {request.isPending
                ? tx("ordering")
                : busy
                  ? tx("inProgress")
                  : t("order")}
            </button>
          </div>

          <ExportHistoryList
            exports={exports ?? []}
            onCancel={(id) => cancel.mutate({ id })}
            heading={t("recentHeading")}
          />
        </>
      ) : (
        <p className="mt-5 rounded-lg border border-tt-kant bg-tt-flade p-3 text-sm text-tt-graa">
          {t("unavailable")}
        </p>
      )}
    </section>
  );
}
