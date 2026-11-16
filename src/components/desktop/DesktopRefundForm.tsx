"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSafeTranslations } from "@/components/ui/use-safe-translations";
import daDesktop from "@/i18n/messages/da/desktop.json";
import { trpc } from "@/providers/trpc-provider";

/**
 * Self-service refund within the money-back window. Verifies license key +
 * email, then refunds in Stripe and revokes the license server-side.
 */
export function DesktopRefundForm() {
  const t = useSafeTranslations("desktop", daDesktop);
  const [licenseKey, setLicenseKey] = useState("");
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  const refund = trpc.desktop.requestRefund.useMutation({
    onSuccess: () => setDone(true),
    onError: (err) => toast.error(err.message || t("genericError")),
  });

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
        <h2 className="mb-1 text-lg font-bold text-slate-900">
          {t("refund.doneTitle")}
        </h2>
        <p className="text-sm text-slate-600">{t("refund.doneBody")}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        refund.mutate({ licenseKey, email });
      }}
      className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-left"
    >
      <div>
        <label
          htmlFor="refund-key"
          className="mb-1 block text-sm font-medium text-slate-900"
        >
          {t("refund.keyLabel")}
        </label>
        <input
          id="refund-key"
          required
          value={licenseKey}
          onChange={(e) => setLicenseKey(e.target.value)}
          placeholder="TT-XXXX-XXXX-XXXX-XXXX"
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-brand-500"
        />
      </div>
      <div>
        <label
          htmlFor="refund-email"
          className="mb-1 block text-sm font-medium text-slate-900"
        >
          {t("refund.emailLabel")}
        </label>
        <input
          id="refund-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("buy.emailPlaceholder")}
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-brand-500"
        />
      </div>
      <button
        type="submit"
        disabled={refund.isPending}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3 font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
      >
        {refund.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          t("refund.submit")
        )}
      </button>
    </form>
  );
}
