"use client";

import { Command } from "cmdk";
import {
  CheckSquare,
  Clock,
  FileText,
  FolderKanban,
  HelpCircle,
  Loader2,
  Plus,
  Search,
  Settings,
  Ticket,
  Users,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  goToShortcutFor,
  type NavGroup,
  type NavItem,
  settingsNavItem,
} from "@/components/dashboard-nav";
import { searchSettings } from "@/components/dashboard-nav/settings-search";
import { useDebounce } from "@/hooks/useDebounce";
import { useModules } from "@/hooks/useModules";
import { openSettingsHref } from "@/hooks/useSettingsAnchor";
import { useVisibleSettingsGroups } from "@/hooks/useVisibleSettingsGroups";
import type { ModuleKey } from "@/lib/modules/constants";
import { isKnownStartPage } from "@/lib/start-page";
import { trpc } from "@/providers/trpc-provider";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Sidemenuens grupper, allerede filtreret efter rolle, modul og flag i
   * DashboardShell. Paletten viser præcis de samme mål.
   */
  navGroups: NavGroup[];
  /** Sidemenuens bundpunkter (Organisation, Adgangsstyring). */
  bottomNavItems: NavItem[];
}

type SearchResultType =
  | "client"
  | "project"
  | "timeEntry"
  | "invoice"
  | "prepaid"
  | "task";

interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle?: string;
  url: string;
}

const typeIcons: Record<SearchResultType, typeof Users> = {
  client: Users,
  project: FolderKanban,
  timeEntry: Clock,
  invoice: FileText,
  prepaid: Ticket,
  task: CheckSquare,
};

interface QuickActionItem {
  /** Stabil nøgle; også nøgle i `palette.action.*`. */
  id: string;
  href?: string;
  action?: () => void;
  requiresModule?: ModuleKey;
}

const QUICK_ACTIONS: QuickActionItem[] = [
  {
    id: "newClient",
    href: "/dashboard/clients/new",
    requiresModule: "clients",
  },
  { id: "newProject", href: "/dashboard/projects/new" },
  {
    id: "quickTime",
    action: () =>
      window.dispatchEvent(new CustomEvent("open-quick-time-entry")),
  },
  {
    id: "newTask",
    href: "/dashboard/tasks/new",
    requiresModule: "tasks",
  },
  {
    id: "newPrepaid",
    href: "/dashboard/klippekort/new",
    requiresModule: "klippekort",
  },
  { id: "newTemplate", href: "/dashboard/templates/new" },
  {
    id: "newInvoice",
    href: "/dashboard/invoices/new",
    requiresModule: "invoicing",
  },
];

export function CommandPalette({
  open,
  onOpenChange,
  navGroups,
  bottomNavItems,
}: CommandPaletteProps) {
  const tNav = useTranslations("nav");
  const t = useTranslations("palette");
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const { isEnabled: isModuleEnabled, isLoading: modulesLoading } =
    useModules();

  // "Gør til startside" (#startside) — kun på sider der er i hvidlisten, og
  // kun når det rent faktisk er en ændring.
  const { data: profile } = trpc.user.getProfile.useQuery();
  const utils = trpc.useUtils();
  const setStartPageMutation = trpc.user.setStartPage.useMutation({
    onSuccess: () => {
      utils.user.getProfile.invalidate();
      toast.success(t("startPageUpdated"));
    },
    onError: (error) => {
      toast.error(error.message || t("startPageFailed"));
    },
  });
  const startPageQuickAction: QuickActionItem | null =
    profile && isKnownStartPage(pathname) && profile.startPage !== pathname
      ? {
          id: "makeStartPage",
          action: () => {
            setStartPageMutation.mutate({ startPage: pathname });
          },
        }
      : null;

  // Search query
  const { data: searchResults, isLoading: isSearching } =
    trpc.search.global.useQuery(
      { query: debouncedSearch, limit: 5 },
      {
        enabled: debouncedSearch.length >= 2,
        staleTime: 30000,
      },
    );

  // Combine all search results
  const allResults: SearchResult[] = searchResults
    ? [
        ...searchResults.clients,
        ...searchResults.projects,
        ...searchResults.timeEntries,
        ...searchResults.invoices,
        ...searchResults.prepaid,
        ...searchResults.tasks,
      ]
    : [];

  const hasSearchResults = allResults.length > 0;
  const showSearchResults = debouncedSearch.length >= 2;

  // Samme mål som sidemenuen (gatet i DashboardShell), plus Indstillinger
  // og Hjælp, som sidemenuen har i bunden/topbjælken.
  const navCommandGroups = useMemo(() => {
    const label = (item: NavItem) =>
      item.translationKey ? tNav(item.translationKey) : item.name;
    const groups = navGroups.map((group) => ({
      heading:
        (group.labelTranslationKey
          ? tNav(group.labelTranslationKey)
          : group.label) || t("mainMenu"),
      items: group.items.map((item) => ({
        label: label(item),
        href: item.href,
        icon: item.icon,
      })),
    }));
    groups.push({
      heading: t("system"),
      items: [
        ...[...bottomNavItems, settingsNavItem].map((item) => ({
          label: label(item),
          href: item.href,
          icon: item.icon,
        })),
        { label: t("help"), href: "/dashboard/help", icon: HelpCircle },
      ],
    });
    return groups;
  }, [navGroups, bottomNavItems, tNav, t]);

  // Indstillinger og enkelte indstillinger ("afrunding", "passkeys"). Vi
  // bruger indstillingssøgningen (ord-præfiks/delstreng) i stedet for cmdk's
  // løse fuzzy-match, der fandt "Portalens farver" for "afrund".
  const settingsGroups = useVisibleSettingsGroups();
  const settingsResults = useMemo(
    () => searchSettings(settingsGroups, search, 6),
    [settingsGroups, search],
  );

  const filteredQuickActions = useMemo(() => {
    const items = QUICK_ACTIONS.filter((item) => {
      if (!item.requiresModule) return true;
      if (modulesLoading) return false;
      return isModuleEnabled(item.requiresModule);
    });
    return startPageQuickAction ? [...items, startPageQuickAction] : items;
  }, [isModuleEnabled, modulesLoading, startPageQuickAction]);

  // Reset search when closing
  useEffect(() => {
    if (!open) {
      setSearch("");
    }
  }, [open]);

  const handleSelect = useCallback(
    (callback: () => void) => {
      onOpenChange(false);
      setSearch("");
      callback();
    },
    [onOpenChange],
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onOpenChange(false);
          }
        }}
        aria-hidden="true"
      />

      {/* Command Palette */}
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] sm:pt-[15vh] px-4 pointer-events-none">
        <div className="w-full max-w-2xl pointer-events-auto">
          <Command
            className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onOpenChange(false);
              }
            }}
          >
            {/* Search Input */}
            <div className="flex items-center border-b border-gray-200 dark:border-gray-700 px-4">
              {isSearching ? (
                <Loader2 className="mr-3 h-5 w-5 shrink-0 text-brand-500 dark:text-brand-400 animate-spin" />
              ) : (
                <Search className="mr-3 h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
              )}
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder={t("placeholder")}
                className="w-full border-none bg-transparent py-4 text-base text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 outline-none"
                autoFocus
              />
              <kbd className="ml-2 hidden rounded bg-gray-100 dark:bg-gray-700 px-2 py-1 text-xs font-semibold text-gray-600 dark:text-gray-300 sm:inline-block">
                ESC
              </kbd>
            </div>

            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              {settingsResults.length === 0 && (
                <Command.Empty className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  {debouncedSearch.length >= 2
                    ? t("emptySearch")
                    : t("emptyPages")}
                </Command.Empty>
              )}

              {/* Search Results */}
              {showSearchResults && hasSearchResults && (
                <Command.Group heading={t("searchResults")}>
                  {allResults.map((result) => {
                    const Icon = typeIcons[result.type];
                    return (
                      <Command.Item
                        key={`${result.type}-${result.id}`}
                        value={`${result.title} ${result.subtitle || ""}`}
                        onSelect={() =>
                          handleSelect(() => router.push(result.url))
                        }
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white transition-colors data-[selected=true]:bg-brand-50 dark:data-[selected=true]:bg-brand-900/30"
                      >
                        <Icon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium">{result.title}</p>
                          {result.subtitle && (
                            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                              {result.subtitle}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 rounded bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300">
                          {t(`type.${result.type}`)}
                        </span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              )}

              {/* Navigation: altid med, cmdk filtrerer på det, man skriver */}
              {navCommandGroups.map((group) => (
                <Command.Group key={group.heading} heading={group.heading}>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const shortcut = goToShortcutFor(item.href);
                    return (
                      <Command.Item
                        key={item.href}
                        // Unik (fx "Rapporter" findes under både Økonomi og
                        // Enterprise) uden at URL'en matcher "dash" o.l.
                        value={`${item.label} ${group.heading}`}
                        onSelect={() =>
                          handleSelect(() => router.push(item.href))
                        }
                        className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white transition-colors data-[selected=true]:bg-brand-50 dark:data-[selected=true]:bg-brand-900/30"
                      >
                        <Icon className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                        <span className="flex-1">{item.label}</span>
                        {shortcut && (
                          <kbd className="text-xs text-gray-400">
                            {shortcut}
                          </kbd>
                        )}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}

              {settingsResults.length > 0 && (
                <Command.Group heading={t("settings")} forceMount>
                  {settingsResults.map((result) => (
                    <Command.Item
                      key={result.key}
                      value={`indstilling ${result.href}`}
                      forceMount
                      onSelect={() =>
                        handleSelect(() =>
                          openSettingsHref(router.push, result.href),
                        )
                      }
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white transition-colors data-[selected=true]:bg-brand-50 dark:data-[selected=true]:bg-brand-900/30"
                    >
                      <Settings className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      <span className="flex-1 truncate">{result.label}</span>
                      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                        {result.context}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {filteredQuickActions.length > 0 && (
                <Command.Group heading={t("quickActions")}>
                  {filteredQuickActions.map((item) => (
                    <Command.Item
                      key={item.id}
                      onSelect={() =>
                        handleSelect(() => {
                          if (item.action) item.action();
                          else if (item.href) router.push(item.href);
                        })
                      }
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-white transition-colors data-[selected=true]:bg-brand-50 dark:data-[selected=true]:bg-brand-900/30"
                    >
                      <Plus className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                      <span>{t(`action.${item.id}`)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>

            {/* Footer */}
            <div className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-4 py-2">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <kbd className="rounded bg-white dark:bg-gray-800 px-1.5 py-0.5 font-mono font-semibold shadow-sm border border-gray-200 dark:border-gray-700">
                      ↑↓
                    </kbd>
                    <span>{t("navigate")}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded bg-white dark:bg-gray-800 px-1.5 py-0.5 font-mono font-semibold shadow-sm border border-gray-200 dark:border-gray-700">
                      ↵
                    </kbd>
                    <span>{t("select")}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded bg-white dark:bg-gray-800 px-1.5 py-0.5 font-mono font-semibold shadow-sm border border-gray-200 dark:border-gray-700">
                      ESC
                    </kbd>
                    <span>{t("close")}</span>
                  </span>
                </div>
                {showSearchResults && hasSearchResults && (
                  <span className="text-gray-400 dark:text-gray-500">
                    {t("resultCount", { count: allResults.length })}
                  </span>
                )}
              </div>
            </div>
          </Command>
        </div>
      </div>
    </>
  );
}
