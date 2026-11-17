"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DashboardBackdrop } from "@/components/auth/DashboardBackdrop";
import { LocaleSwitcher } from "@/components/auth/LocaleSwitcher";
import { BrandLogo as Logo } from "@/components/BrandContext";
import { DEMO_REPO_URL, DEMO_SELF_HOST_URL } from "./DemoBanner";

const ERRORS = ["rate_limited", "full", "error"] as const;

/**
 * Login-siden på den offentlige demo (DEMO_MODE=1): kun "Prøv demoen".
 * Almindeligt login, signup, OAuth, magic link og SMS findes ikke her.
 * Knappen er en almindelig formular-POST til /api/demo/start, som opretter
 * kontoen, logger ind og sender videre til dashboardet.
 */
export function DemoLogin() {
  const t = useTranslations("demo.login");
  const tBanner = useTranslations("demo.banner");
  const searchParams = useSearchParams();
  const [starting, setStarting] = useState(false);
  const code = searchParams.get("demo");
  const error = ERRORS.find((e) => e === code);

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <DashboardBackdrop />
      <div className="fixed inset-0 bg-white/60 dark:bg-gray-950/70 backdrop-blur-sm" />
      <LocaleSwitcher className="fixed right-4 top-4 z-20" />

      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="text-center">
          <Logo size="lg" />
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t("title")}
          </h1>
        </div>

        <form
          method="post"
          action="/api/demo/start"
          onSubmit={() => setStarting(true)}
          className="space-y-6 rounded-lg bg-white dark:bg-gray-800 p-8 shadow-md"
        >
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-900 dark:text-amber-300"
            >
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p>{t(`errors.${error}`)}</p>
            </div>
          )}
          <p className="text-gray-700 dark:text-gray-300">{t("body")}</p>
          <button
            type="submit"
            disabled={starting}
            className="w-full rounded-lg bg-tt-gran px-4 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                {t("starting")}
              </span>
            ) : (
              t("button")
            )}
          </button>
          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <p>{t("noSignup")}</p>
            <p className="flex gap-4">
              <a
                href={DEMO_SELF_HOST_URL}
                className="font-medium text-brand-600 dark:text-brand-400 hover:text-brand-500 dark:hover:text-brand-300"
              >
                {tBanner("selfHost")}
              </a>
              <a
                href={DEMO_REPO_URL}
                className="font-medium text-brand-600 dark:text-brand-400 hover:text-brand-500 dark:hover:text-brand-300"
              >
                {tBanner("github")}
              </a>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
