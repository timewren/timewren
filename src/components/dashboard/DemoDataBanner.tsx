"use client";

import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { trpc } from "@/providers/trpc-provider";

/**
 * Vises når kontoen kører med demo-eksempeldata (#86): gør det tydeligt
 * at tallene er eksempler, og giver ét-kliks oprydning når brugeren er
 * klar til at starte med egne data.
 */
export function DemoDataBanner() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("dashboard.demo");
  const utils = trpc.useUtils();
  const { data } = trpc.onboarding.demoStatus.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });

  const clearMutation = trpc.onboarding.clearDemoData.useMutation({
    onSuccess: async ({ cleared, kept }) => {
      if (kept > 0) {
        toast.success(t("clearedKept", { kept }));
      } else {
        toast.success(cleared > 0 ? t("cleared") : t("nothingToClear"));
      }
      // Demo-data rører klienter, projekter, tid, klippekort og widgets —
      // invalider hele cachen frem for at jage hver enkelt query.
      await utils.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || t("clearFailed"));
    },
  });

  if (!data?.hasDemoData) return null;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 sm:flex-row sm:items-center dark:border-brand-600 dark:bg-tt-gran-lys">
      <div className="flex flex-1 items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-tt-graa" />
        <p className="text-sm text-slate-700 dark:text-slate-300">
          {t.rich("banner", {
            brand: brand.name,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          if (window.confirm(t("confirm"))) {
            clearMutation.mutate();
          }
        }}
        disabled={clearMutation.isPending}
        className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-brand-300 bg-white px-4 py-2 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100 disabled:opacity-60 dark:bg-transparent dark:text-brand-300"
      >
        {clearMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
        {t("clearButton")}
      </button>
    </div>
  );
}
