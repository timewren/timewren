"use client";

import { Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import type { SettingsNavGroup } from "@/components/dashboard-nav";
import {
  activeSettingsHref,
  searchSettings,
} from "@/components/dashboard-nav/settings-search";
import { openSettingsHref, useSettingsAnchor } from "@/hooks/useSettingsAnchor";
import { useVisibleSettingsGroups } from "@/hooks/useVisibleSettingsGroups";

function SettingsSidebar({
  groups,
  onNavigate,
}: {
  groups: SettingsNavGroup[];
  onNavigate?: () => void;
}) {
  const t = useTranslations("settingsShell");
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputId = useId();
  const resultsId = useId();

  const query = search.trim();
  const results = useMemo(
    () => (query ? searchSettings(groups, query) : []),
    [groups, query],
  );
  const activeHref = activeSettingsHref(groups, pathname);

  const go = (href: string) => {
    setSearch("");
    setActiveIndex(0);
    onNavigate?.();
    openSettingsHref(router.push, href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && search) {
      e.preventDefault();
      setSearch("");
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[Math.min(activeIndex, results.length - 1)].href);
    }
  };

  return (
    <>
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          {t("searchLabel")}
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
        <input
          id={inputId}
          type="search"
          placeholder={t("searchPlaceholder")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          aria-controls={query ? resultsId : undefined}
          autoComplete="off"
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 dark:focus:border-brand-400"
        />
      </div>

      {query ? (
        <div className="mt-3" id={resultsId}>
          <p className="sr-only" aria-live="polite">
            {results.length === 0
              ? t("noResults")
              : t("resultCount", { count: results.length })}
          </p>
          {results.length === 0 ? (
            <p className="px-1 text-sm text-gray-500 dark:text-gray-400">
              {t("noMatch", { query })}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {results.map((result, i) => (
                <li key={result.key}>
                  <Link
                    href={result.href}
                    onClick={(e) => {
                      e.preventDefault();
                      go(result.href);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                      i === activeIndex
                        ? "bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300"
                        : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/50"
                    }`}
                  >
                    <span className="block font-medium">{result.label}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      {result.context}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <nav className="mt-4 space-y-5" aria-label={t("navLabel")}>
          {groups.map((group) => (
            <div key={group.label}>
              <h3 className="mb-1 px-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                {group.label}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = item.href === activeHref;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                          active
                            ? "bg-brand-50 font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300"
                            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700/50"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      )}
    </>
  );
}

/**
 * Rammen om alle indstillingssider: venstremenu med grupper og søgning,
 * dybe links (#anker) og mobilmenu. Bruges af /dashboard/settings og
 * /dashboard/organization, så organisationssiderne ligger samme sted.
 */
export function SettingsShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("settingsShell");
  const pathname = usePathname();
  const groups = useVisibleSettingsGroups();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useSettingsAnchor();

  // Mobilknappen viser, hvilken indstillingsside man står på
  const activeHref = activeSettingsHref(groups, pathname);
  const currentLabel = groups
    .flatMap((group) => group.items)
    .find((item) => item.href === activeHref)?.label;

  return (
    <div>
      {/* Mobil: menuen står øverst på forsiden, ellers bag en knap */}
      <div className="mb-4 md:hidden">
        {pathname === "/dashboard/settings" ? (
          <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
            <SettingsSidebar groups={groups} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
            aria-label={t("openMenu")}
          >
            <Menu className="h-4 w-4" />
            {currentLabel ? (
              <span>
                {t.rich("currentPage", {
                  page: currentLabel ?? "",
                  b: (chunks) => (
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {chunks}
                    </span>
                  ),
                })}
              </span>
            ) : (
              t("menuButton")
            )}
          </button>
        )}
      </div>

      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside
            className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto bg-white p-5 shadow-xl dark:bg-gray-900 md:hidden"
            aria-label={t("menuButton")}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("navLabel")}
              </h2>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="rounded-md p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                aria-label={t("closeMenu")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SettingsSidebar
              groups={groups}
              onNavigate={() => setSidebarOpen(false)}
            />
          </aside>
        </>
      )}

      <div className="flex gap-8">
        <aside
          className="hidden w-56 shrink-0 md:block"
          data-tour="settings-sidebar"
        >
          {/* top-20: under den faste topbjælke (h-14). Egen rulning, så
              menuens nederste punkter kan nås på lave skærme. */}
          <div className="sticky top-20 -mx-1 max-h-[calc(100vh-6rem)] overflow-y-auto px-1 pt-1 pb-4">
            <SettingsSidebar groups={groups} />
          </div>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
