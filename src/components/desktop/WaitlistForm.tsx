"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { useSafeTranslations } from "@/components/ui/use-safe-translations";
import daDesktop from "@/i18n/messages/da/desktop.json";

export function WaitlistForm() {
  const t = useSafeTranslations("desktop", daDesktop);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/desktop/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg(data.error || t("waitlist.error"));
      }
    } catch {
      setStatus("error");
      setErrorMsg(t("waitlist.connectionError"));
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl bg-green-50 p-6 ring-1 ring-green-200">
        <Check className="mx-auto mb-2 h-8 w-8 text-green-600" />
        <p className="font-medium text-green-800">{t("waitlist.joined")}</p>
        <p className="mt-1 text-sm text-green-600">
          {t("waitlist.joinedNote")}
        </p>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex gap-3 sm:gap-4">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("buy.emailPlaceholder")}
          required
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-3 font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {status === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            t("waitlist.submit")
          )}
        </button>
      </form>

      {status === "error" && (
        <p className="mt-3 text-sm text-red-600">{errorMsg}</p>
      )}
    </>
  );
}
