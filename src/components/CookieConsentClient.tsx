"use client";

import { Check, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CookiePreferences,
  readConsent,
  writeConsent,
} from "@/lib/consent";

const CONSENT_VERSION = "1.0";

export interface CookieConsentLabels {
  regionLabel: string;
  bannerText: string;
  readMore: string;
  acceptAll: string;
  necessaryOnly: string;
  chooseYourself: string;
  settingsTitle: string;
  settingsIntro: string;
  closeSettings: string;
  necessaryTitle: string;
  alwaysActive: string;
  necessaryBody: string;
  statsTitle: string;
  statsToggle: string;
  statsBody: string;
  statsLink: string;
  marketingTitle: string;
  marketingBody: string;
  saveChoice: string;
}

export function CookieConsentClient({
  labels,
  marketing = true,
}: {
  labels: CookieConsentLabels;
  /** Marketingvalget (Google Ads) vises. Slået fra i den offentlige demo. */
  marketing?: boolean;
}) {
  // Banneret server-renderes synligt, så det males med første paint i stedet
  // for først efter hydrering (det var LCP-elementet på flere marketingsider).
  // Besøgende der allerede har valgt, får det skjult før paint af det inline
  // script i root-layoutet (data-cookie-consent) og afmonteret i effekten.
  const [showBanner, setShowBanner] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Dashboardet har FloatingTimerButton/feedback-panelet fast i nederste
  // højre hjørne (se deres fixed bottom-X right-X): her bevares det smalle
  // kort i nederste venstre hjørne, som ikke kan ramme dem. På marketing-
  // siderne er der intet dernede at undgå, og her lagde kortet sig i stedet
  // over indhold (QA-fund #6) — der bruges en fuldbredde bundbjælke.
  const pathname = usePathname();
  const isDashboard = (pathname ?? "").startsWith("/dashboard");

  // Dialogen: fokus ind ved åbning, Escape lukker (aria-modal lover det).
  useEffect(() => {
    if (!showSettings) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowSettings(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showSettings]);
  const [preferences, setPreferences] = useState<CookiePreferences>({
    necessary: true,
    analytics: false,
    marketing: false,
    timestamp: Date.now(),
  });
  const enablePlausible = useCallback(() => {
    // Enable Plausible tracking
    if (typeof window !== "undefined") {
      // @ts-expect-error
      window.plausible =
        // @ts-expect-error
        window.plausible ||
        ((...args: unknown[]) => {
          // @ts-expect-error
          // biome-ignore lint/suspicious/noAssignInExpressions: Standard Plausible analytics initialization pattern
          (window.plausible.q = window.plausible.q || []).push(args);
        });
    }
  }, []);

  const disablePlausible = useCallback(() => {
    // Disable Plausible tracking
    if (typeof window !== "undefined") {
      // @ts-expect-error
      window.plausible = undefined;
    }
  }, []);

  useEffect(() => {
    // Check if user has already made a choice (delt cookie → localStorage)
    const parsed = readConsent();
    if (!parsed) {
      setShowBanner(true);
    } else {
      setShowBanner(false);
      setPreferences(parsed);
      // Apply analytics preference
      if (parsed.analytics) {
        enablePlausible();
      }
    }
  }, [enablePlausible]);

  const savePreferences = (prefs: CookiePreferences) => {
    const toSave = {
      ...prefs,
      necessary: true, // Always true
      timestamp: Date.now(),
      version: CONSENT_VERSION,
    };
    writeConsent(toSave);
    setPreferences(toSave);

    // Apply analytics preference
    if (toSave.analytics) {
      enablePlausible();
    } else {
      disablePlausible();
    }

    // Notify GoogleAds component of consent change
    window.dispatchEvent(new CustomEvent("cookie-consent-updated"));

    setShowBanner(false);
    setShowSettings(false);
  };

  const acceptAll = () => {
    savePreferences({
      necessary: true,
      analytics: true,
      marketing,
      timestamp: Date.now(),
    });
  };

  const acceptNecessary = () => {
    savePreferences({
      necessary: true,
      analytics: false,
      marketing: false,
      timestamp: Date.now(),
    });
  };

  if (!showBanner && !showSettings) {
    return null;
  }

  if (showSettings) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cookie-settings-title"
          className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[14px] border border-tt-streg bg-tt-flade-hoej p-6 text-tt-blaek shadow-xl"
        >
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2
                id="cookie-settings-title"
                className="text-xl font-bold tracking-[-0.015em] sm:text-2xl"
              >
                {labels.settingsTitle}
              </h2>
              <p className="mt-2 text-sm text-tt-graa">
                {labels.settingsIntro}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setShowSettings(false)}
              aria-label={labels.closeSettings}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-tt-graa transition-colors hover:bg-tt-flade hover:text-tt-blaek"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-tt-streg p-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-semibold">{labels.necessaryTitle}</h3>
                <span className="inline-flex items-center gap-1 rounded-full border border-tt-streg px-3 py-1 text-xs font-medium text-tt-graa">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {labels.alwaysActive}
                </span>
              </div>
              <p className="mt-1 text-sm text-tt-graa">
                {labels.necessaryBody}
              </p>
            </div>

            <div className="rounded-lg border border-tt-streg p-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-semibold">{labels.statsTitle}</h3>
                <CookieToggle
                  label={labels.statsToggle}
                  checked={preferences.analytics}
                  onChange={(analytics) =>
                    setPreferences({ ...preferences, analytics })
                  }
                />
              </div>
              <p className="mt-1 text-sm text-tt-graa">{labels.statsBody}</p>
              <Link
                href="/cookies"
                className="mt-2 inline-block text-sm font-medium text-tt-gran underline underline-offset-2"
              >
                {labels.statsLink}
              </Link>
            </div>

            {marketing && (
              <div className="rounded-lg border border-tt-streg p-4">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-semibold">{labels.marketingTitle}</h3>
                  <CookieToggle
                    label={labels.marketingTitle}
                    checked={preferences.marketing}
                    onChange={(marketing) =>
                      setPreferences({ ...preferences, marketing })
                    }
                  />
                </div>
                <p className="mt-1 text-sm text-tt-graa">
                  {labels.marketingBody}
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => savePreferences(preferences)}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-tt-gran px-6 font-semibold text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
            >
              {labels.saveChoice}
            </button>
            <button
              type="button"
              onClick={acceptAll}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-tt-kant px-6 font-semibold text-tt-blaek transition-colors hover:bg-tt-flade"
            >
              {labels.acceptAll}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section
      data-cookie-banner=""
      aria-label={labels.regionLabel}
      className={
        isDashboard
          ? "fixed inset-x-3 bottom-16 z-50 rounded-[14px] border border-tt-streg bg-tt-flade-hoej p-4 text-tt-blaek shadow-lg sm:inset-x-auto sm:left-4 sm:max-w-sm lg:bottom-4"
          : "fixed inset-x-0 bottom-0 z-50 border-t border-tt-streg bg-tt-flade-hoej p-3 text-tt-blaek shadow-lg sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-4"
      }
    >
      <p className="text-sm leading-relaxed text-tt-graa sm:max-w-xl">
        {labels.bannerText}{" "}
        <Link
          href="/cookies"
          className="font-medium text-tt-gran underline underline-offset-2"
        >
          {labels.readMore}
        </Link>
      </p>
      <div
        className={
          isDashboard
            ? "mt-3 flex flex-wrap items-center gap-2"
            : "mt-3 flex flex-wrap items-center gap-2 sm:mt-0 sm:shrink-0"
        }
      >
        <button
          type="button"
          onClick={acceptAll}
          className="inline-flex min-h-11 items-center rounded-lg bg-tt-gran px-4 text-sm font-semibold text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk sm:min-h-9"
        >
          {labels.acceptAll}
        </button>
        <button
          type="button"
          onClick={acceptNecessary}
          className="inline-flex min-h-11 items-center rounded-lg border border-tt-kant px-4 text-sm font-semibold text-tt-blaek transition-colors hover:bg-tt-flade sm:min-h-9"
        >
          {labels.necessaryOnly}
        </button>
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-medium text-tt-graa hover:text-tt-blaek sm:min-h-9"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
          {labels.chooseYourself}
        </button>
      </div>
    </section>
  );
}

function CookieToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="relative inline-flex h-11 cursor-pointer items-center">
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="h-6 w-11 rounded-full border border-tt-kant bg-tt-flade transition-colors peer-checked:border-tt-gran peer-checked:bg-tt-gran peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-tt-fokus" />
      <span className="pointer-events-none absolute left-[3px] h-[18px] w-[18px] rounded-full bg-tt-kant transition-transform peer-checked:translate-x-5 peer-checked:bg-tt-paa-gran" />
    </label>
  );
}

// Export function to open settings from anywhere
export function openCookieSettings() {
  // Trigger a custom event that the CookieConsent component can listen to
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("open-cookie-settings"));
  }
}
