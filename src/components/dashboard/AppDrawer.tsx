"use client";

import {
  Apple,
  AppWindow,
  LayoutGrid,
  Monitor,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useBrand } from "@/components/BrandContext";
import { useLatestDesktopRelease } from "@/components/desktop/useLatestDesktopRelease";
import { usePwaInstall } from "@/hooks/usePwaInstall";

const EXTENSION_URL =
  "https://chromewebstore.google.com/detail/omfnfamlmdfaobhcphdfhcnihcllekof";
const DESKTOP_SETTINGS_PATH = "/dashboard/settings/desktop";

const tileClass =
  "flex items-start gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/30";
const iconClass = "h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400 mt-0.5";
const titleClass =
  "block text-sm font-medium text-gray-900 dark:text-white truncate";
const hintClass =
  "block text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5";

/**
 * Apps-menu i topbaren: TimeTrack Desktop, Chrome-udvidelsen og
 * installation som app (PWA).
 *
 * Håndrullet dropdown efter mønsteret fra brugermenuen i dashboard-layoutet —
 * repoet har ingen dropdown-primitiv (ingen Radix).
 */
export function AppDrawer() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("dashboard.appDrawer");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { os, winUrl, macUrl, version, hasDownloads } =
    useLatestDesktopRelease();
  // Delt med PWAInstallPrompt — browserens prompt-event må kun bruges én gang.
  const { canInstall, isInstalled, install } = usePwaInstall();

  // Click-outside + Escape
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // OS-korrekt download: brugerens eget styresystem først.
  const desktopUrl = os === "macos" ? macUrl : winUrl;
  const desktopLabel = os === "macos" ? "macOS" : "Windows";
  const DesktopIcon = os === "macos" ? Apple : Monitor;

  const handleInstallPwa = async () => {
    setOpen(false);
    await install();
  };

  return (
    <div ref={containerRef} className="relative hidden lg:flex shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("apps")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("apps")}
        className="flex items-center justify-center rounded-lg p-2 text-gray-600 dark:text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
      >
        <LayoutGrid className="h-5 w-5" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t("apps")}
          className="absolute right-0 top-12 z-[60] w-72 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2 shadow-sm"
        >
          <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("heading", { brand: brand.name })}
          </p>

          <div className="space-y-1.5">
            {/* Desktop */}
            {desktopUrl ? (
              <a
                role="menuitem"
                href={desktopUrl}
                onClick={() => setOpen(false)}
                className={tileClass}
              >
                <DesktopIcon className={iconClass} />
                <span className="min-w-0">
                  <span className={titleClass}>{brand.name} Desktop</span>
                  <span className={hintClass}>
                    {t("downloadFor", {
                      os: desktopLabel,
                      version: version ? ` · v${version}` : "",
                    })}
                  </span>
                </span>
              </a>
            ) : (
              <Link
                role="menuitem"
                href={DESKTOP_SETTINGS_PATH}
                onClick={() => setOpen(false)}
                className={tileClass}
              >
                <DesktopIcon className={iconClass} />
                <span className="min-w-0">
                  <span className={titleClass}>{brand.name} Desktop</span>
                  <span className={hintClass}>
                    {hasDownloads ? t("seeDownloads") : t("downloadComing")}
                  </span>
                </span>
              </Link>
            )}

            {/* Chrome-udvidelse */}
            <a
              role="menuitem"
              href={EXTENSION_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className={tileClass}
            >
              <AppWindow className={iconClass} />
              <span className="min-w-0">
                <span className={titleClass}>{t("chromeExtension")}</span>
                <span className={hintClass}>{t("chromeExtensionHint")}</span>
              </span>
            </a>

            {/* PWA */}
            {canInstall ? (
              <button
                type="button"
                role="menuitem"
                onClick={handleInstallPwa}
                className={`${tileClass} w-full`}
              >
                <Smartphone className={iconClass} />
                <span className="min-w-0">
                  <span className={titleClass}>{t("installApp")}</span>
                  <span className={hintClass}>
                    {t("installAppHint", { brand: brand.name })}
                  </span>
                </span>
              </button>
            ) : (
              <Link
                role="menuitem"
                href="/dashboard/settings"
                onClick={() => setOpen(false)}
                className={tileClass}
              >
                <Smartphone className={iconClass} />
                <span className="min-w-0">
                  <span className={titleClass}>{t("installApp")}</span>
                  <span className={hintClass}>
                    {isInstalled ? t("alreadyInstalled") : t("addToHome")}
                  </span>
                </span>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
