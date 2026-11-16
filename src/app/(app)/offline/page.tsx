"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { BrandLogo as Logo, useBrand } from "@/components/BrandContext";
import { isAppReachable } from "@/lib/pwa/version";

/**
 * Offline-siden i brandets stil (som not-found.tsx): venstrestillet, tokens,
 * forklar hvad der skete og hvad man gør. Kun påstande, der passer: timer
 * startet, stoppet eller oprettet i en åben fane under et netudfald lægges
 * i offline-køen (src/lib/offline/queue.ts, #703).
 */
export default function OfflinePage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("offline");
  const router = useRouter();
  // null = ukendt indtil mount. navigator.onLine må ikke læses under render,
  // ellers afviger server- og klient-HTML (hydration-fejl, React #418).
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let leaving = false;
    // Send kun videre, når appen faktisk svarer. navigator.onLine er true
    // bag captive portals og på ustabile net, og et redirect derfra ender
    // her igen: en genindlæsningsløkke.
    const tryLeave = async () => {
      if (leaving || !(await isAppReachable())) return;
      leaving = true;
      router.replace("/dashboard");
    };
    const handleOnline = () => {
      setIsOnline(true);
      void tryLeave();
    };
    const handleOffline = () => setIsOnline(false);

    setIsOnline(navigator.onLine);
    if (navigator.onLine) void tryLeave();

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [router]);

  return (
    <main className="flex min-h-screen items-center bg-tt-papir px-4 py-16 text-tt-blaek">
      <div className="mx-auto w-full max-w-xl">
        <Logo size="lg" />

        <p className="mt-16 text-sm font-medium text-tt-graa">{t("label")}</p>
        <h1 className="mt-2 text-4xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mt-6 max-w-[60ch] text-lg leading-relaxed text-tt-graa">
          {t("text", { brand: brand.name })}
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-tt-gran px-5 font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            {t("retry")}
          </button>
          <p className="text-sm text-tt-graa" aria-live="polite">
            {isOnline === false ? t("waiting") : t("autoReload")}
          </p>
        </div>
      </div>
    </main>
  );
}
