"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useSafeTranslations } from "@/components/ui/use-safe-translations";
import daDesktop from "@/i18n/messages/da/desktop.json";
import { trpc } from "@/providers/trpc-provider";

/** Self-service "email me my license key" — always responds generically. */
export function DesktopResendKeyForm() {
  const t = useSafeTranslations("desktop", daDesktop);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  const resend = trpc.desktop.resendLicenseKey.useMutation({
    onSuccess: () => setSentTo(email),
    onError: (err) => toast.error(err.message || t("genericError")),
  });

  if (sentTo) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" />
        <h2 className="mb-1 text-lg font-bold text-slate-900">
          {t("resend.doneTitle")}
        </h2>
        <p className="text-sm text-slate-600">
          {t.rich("resend.doneBody", {
            email: sentTo,
            b: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        resend.mutate({ email });
      }}
      className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-left"
    >
      <label
        htmlFor="resend-email"
        className="text-sm font-medium text-slate-900"
      >
        {t("resend.emailLabel")}
      </label>
      <input
        id="resend-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("buy.emailPlaceholder")}
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-brand-500"
      />
      <button
        type="submit"
        disabled={resend.isPending}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
      >
        {resend.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          t("resend.submit")
        )}
      </button>
    </form>
  );
}
