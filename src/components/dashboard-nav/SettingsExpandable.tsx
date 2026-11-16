"use client";

import { ChevronDown, Settings } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { settingsSubItems } from "./navigation-config";

interface SettingsExpandableProps {
  collapsed: boolean;
  pathname: string;
  onNavigate: () => void;
}

export function SettingsExpandable({
  collapsed,
  pathname,
  onNavigate,
}: SettingsExpandableProps) {
  const { enabled: billingEnabled } = useBillingEnabled();
  const t = useTranslations("shell");
  const tNav = useTranslations("nav");
  const isSettingsActive =
    pathname === "/dashboard/settings" ||
    pathname.startsWith("/dashboard/settings/");

  const [expanded, setExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("settings-nav-expanded");
        if (saved !== null) return JSON.parse(saved);
      } catch {
        // Ignore corrupted localStorage values
      }
    }
    return false;
  });

  // Auto-expand when on a settings page
  useEffect(() => {
    if (isSettingsActive && !expanded) {
      setExpanded(true);
      localStorage.setItem("settings-nav-expanded", "true");
    }
  }, [isSettingsActive, expanded]);

  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem("settings-nav-expanded", JSON.stringify(next));
  };

  // Collapsed: just show icon link
  if (collapsed) {
    return (
      <Link
        href="/dashboard/settings"
        onClick={onNavigate}
        title={tNav("settings")}
        aria-current={isSettingsActive ? "page" : undefined}
        className={`flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
          isSettingsActive
            ? "bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400"
            : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
        }`}
      >
        <Settings className="h-5 w-5 shrink-0" />
      </Link>
    );
  }

  return (
    <div>
      <div className="flex items-center">
        <Link
          href="/dashboard/settings"
          onClick={onNavigate}
          aria-current={pathname === "/dashboard/settings" ? "page" : undefined}
          className={`flex flex-1 items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            isSettingsActive
              ? "bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400"
              : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
          }`}
        >
          <Settings className="h-5 w-5 shrink-0" />
          <span>{tNav("settings")}</span>
        </Link>
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label={expanded ? t("hideSubmenu") : t("showSubmenu")}
          aria-expanded={expanded}
          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 transition-colors"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {expanded && (
        <div className="ml-8 mt-0.5 space-y-0.5 border-l border-gray-200 dark:border-gray-700 pl-2">
          {settingsSubItems
            .filter(
              (sub) =>
                billingEnabled ||
                sub.href !== "/dashboard/settings/subscription",
            )
            .map((sub) => {
              const isSubActive = pathname === sub.href;
              return (
                <Link
                  key={sub.href}
                  href={sub.href}
                  onClick={onNavigate}
                  aria-current={isSubActive ? "page" : undefined}
                  className={`block rounded-lg px-2 py-1 text-sm transition-colors ${
                    isSubActive
                      ? "text-brand-700 font-medium dark:text-brand-400"
                      : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
                  }`}
                >
                  {t.has(`settingsSub.${sub.href.split("/").pop()}`)
                    ? t(`settingsSub.${sub.href.split("/").pop()}`)
                    : sub.name}
                </Link>
              );
            })}
        </div>
      )}
    </div>
  );
}
