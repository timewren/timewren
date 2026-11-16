"use client";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";

export function ImportStatusBanner() {
  const t = useTranslations("importer.banner");
  const [dismissed, setDismissed] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  const { data } = trpc.imports.listImports.useQuery(undefined, {
    refetchInterval: (query) => {
      const imports = query.state.data;
      if (!imports) return 5000;
      const active = imports.find(
        (i) =>
          i.status === "running" ||
          i.status === "processing" ||
          i.status === "previewing",
      );
      return active ? 3000 : 30000;
    },
  });

  const activeImport = data?.find(
    (i) =>
      i.status === "running" ||
      i.status === "processing" ||
      i.status === "previewing",
  );

  const recentlyCompleted = data?.find(
    (i) =>
      (i.status === "completed" || i.status === "completed_with_errors") &&
      i.completedAt &&
      Date.now() - new Date(i.completedAt).getTime() < 5 * 60 * 1000,
  );

  // Toast when status transitions to terminal
  useEffect(() => {
    if (!data?.[0]) return;
    const current = data[0];
    const prev = prevStatusRef.current;
    prevStatusRef.current = current.status;

    if (prev && prev !== current.status) {
      if (current.status === "completed") {
        toast.success(t("doneToast", { count: current.importedEntries ?? 0 }));
        setDismissed(false);
      } else if (current.status === "completed_with_errors") {
        toast.warning(
          t("doneWithErrorsToast", {
            imported: current.importedEntries ?? 0,
            failed: current.failedEntries ?? 0,
          }),
        );
        setDismissed(false);
      } else if (current.status === "failed") {
        toast.error(t("failedToast"));
        setDismissed(false);
      }
    }
  }, [data, t]);

  if (dismissed) return null;

  if (activeImport) {
    const pct =
      activeImport.totalEntries > 0
        ? Math.round(
            ((activeImport.importedEntries ?? 0) / activeImport.totalEntries) *
              100,
          )
        : 0;
    return (
      <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm dark:border-brand-600 dark:bg-tt-gran-lys">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-600 dark:text-brand-400" />
        <span className="text-brand-800 dark:text-brand-200">
          {t("running", {
            pct,
            imported: activeImport.importedEntries ?? 0,
            total: activeImport.totalEntries,
          })}
        </span>
        <Link
          href="/dashboard/integrations/import-timeops"
          className="ml-auto text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("details")}
        </Link>
      </div>
    );
  }

  if (recentlyCompleted) {
    const isError = recentlyCompleted.status === "completed_with_errors";
    return (
      <div
        className={`flex items-center gap-3 rounded-lg border px-4 py-2 text-sm ${
          isError
            ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
            : "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
        }`}
      >
        {isError ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
        )}
        <span
          className={
            isError
              ? "text-amber-800 dark:text-amber-200"
              : "text-green-800 dark:text-green-200"
          }
        >
          {(recentlyCompleted.failedEntries ?? 0) > 0
            ? t("doneWithFailed", {
                count: recentlyCompleted.importedEntries ?? 0,
                failed: recentlyCompleted.failedEntries ?? 0,
              })
            : t("done", { count: recentlyCompleted.importedEntries ?? 0 })}
        </span>
        <Link
          href="/dashboard/integrations/import-timeops"
          className="text-xs font-medium hover:underline"
        >
          {t("details")}
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("dismiss")}
          className="ml-auto shrink-0 text-gray-400 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return null;
}
