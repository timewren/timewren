"use client";

import { Command } from "cmdk";
import {
  Activity,
  ArrowRight,
  LayoutDashboard,
  Loader2,
  Mail,
  MailQuestion,
  Map as MapIcon,
  MessageSquare,
  MessageSquareHeart,
  Monitor,
  Search,
  Settings,
  Sparkles,
  Ticket,
  Users,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { trpc } from "@/providers/trpc-provider";

interface AdminCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NAV_ITEMS = [
  { labelKey: "nav.dashboard", href: "/admin", icon: LayoutDashboard },
  { labelKey: "nav.users", href: "/admin/users", icon: Users },
  { labelKey: "nav.support", href: "/admin/support", icon: MessageSquare },
  { labelKey: "nav.finance", href: "/admin/finance", icon: Wallet },
  { labelKey: "nav.growth", href: "/admin/growth", icon: ArrowRight },
  { labelKey: "nav.analytics", href: "/admin/analytics", icon: ArrowRight },
  { labelKey: "nav.broadcasts", href: "/admin/broadcasts", icon: Mail },
  { labelKey: "nav.monitoring", href: "/admin/monitoring", icon: Monitor },
  { labelKey: "nav.stability", href: "/admin/stabilitet", icon: Monitor },
  { labelKey: "nav.webhooks", href: "/admin/webhooks", icon: ArrowRight },
  {
    labelKey: "nav.emailForwarding",
    href: "/admin/email-forwarding",
    icon: MailQuestion,
  },
  { labelKey: "nav.compliance", href: "/admin/compliance", icon: ArrowRight },
  {
    labelKey: "nav.onboardingFunnel",
    href: "/admin/growth?tab=funnel",
    icon: ArrowRight,
  },
  {
    labelKey: "nav.scenarios",
    href: "/admin/growth?tab=scenarios",
    icon: ArrowRight,
  },
  {
    labelKey: "nav.security",
    href: "/admin/compliance?tab=security",
    icon: ArrowRight,
  },
  {
    labelKey: "nav.gdpr",
    href: "/admin/compliance?tab=gdpr",
    icon: ArrowRight,
  },
  {
    labelKey: "nav.activity",
    href: "/admin/compliance?tab=activity",
    icon: Activity,
  },
  {
    labelKey: "nav.helpFeedback",
    href: "/admin/help-feedback",
    icon: MessageSquareHeart,
  },
  { labelKey: "nav.roadmap", href: "/admin/roadmap", icon: MapIcon },
  { labelKey: "nav.settings", href: "/admin/settings", icon: Settings },
];

const TYPE_ICONS = {
  user: Users,
  ticket: Ticket,
  roadmap: MapIcon,
  changelog: Sparkles,
} as const;

export function AdminCommandPalette({
  open,
  onOpenChange,
}: AdminCommandPaletteProps) {
  const t = useTranslations("adminShell");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 200);

  const { data: searchResults, isFetching } = trpc.admin.search.global.useQuery(
    { query: debouncedQuery },
    {
      enabled: open && debouncedQuery.trim().length > 0,
      staleTime: 10_000,
    },
  );

  // Reset query when closing
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Open with Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  const navigate = (url: string) => {
    onOpenChange(false);
    router.push(url);
  };

  // Group results by type for cleaner UI
  const grouped = searchResults
    ? searchResults.reduce(
        (acc, r) => {
          if (!acc[r.type]) acc[r.type] = [];
          acc[r.type].push(r);
          return acc;
        },
        {} as Record<string, typeof searchResults>,
      )
    : {};

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={() => onOpenChange(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" />

      {/* Palette */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: wrapper stopper kun bobling af klik, den er ikke selv et kontrolelement */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: wrapper stopper kun bobling af klik, den er ikke selv et kontrolelement */}
      <div
        className="relative w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command label={t("palette.label")} className="bg-white">
          <div className="flex items-center gap-3 border-b border-gray-200 px-4">
            <Search className="h-4 w-4 shrink-0 text-gray-400" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={t("palette.placeholder")}
              className="w-full border-0 bg-transparent py-4 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
            />
            {isFetching && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-400" />
            )}
            <kbd className="hidden shrink-0 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-500 sm:inline">
              esc
            </kbd>
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-gray-500">
              {debouncedQuery.trim().length === 0
                ? t("palette.hint")
                : t("palette.noResults")}
            </Command.Empty>

            {/* Search results grouped by type */}
            {(["user", "ticket", "roadmap", "changelog"] as const).map(
              (type) => {
                const items = grouped[type];
                if (!items || items.length === 0) return null;
                const Icon = TYPE_ICONS[type];
                return (
                  <Command.Group
                    key={type}
                    heading={t(`palette.group.${type}`)}
                    className="mb-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-gray-400"
                  >
                    {items.map((r) => (
                      <Command.Item
                        key={`${r.type}-${r.id}`}
                        value={`${r.type} ${r.title} ${r.subtitle ?? ""}`}
                        onSelect={() => navigate(r.url)}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-brand-50 aria-selected:text-brand-900"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-gray-400 [aria-selected]:text-brand-500" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-900">
                            {r.title}
                          </p>
                          {r.subtitle && (
                            <p className="truncate text-xs text-gray-500">
                              {r.subtitle}
                            </p>
                          )}
                        </div>
                        <span className="hidden shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 sm:inline">
                          {t(`palette.type.${r.type}`)}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              },
            )}

            {/* Always-available navigation */}
            <Command.Group
              heading={t("palette.jumpTo")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-gray-400"
            >
              {NAV_ITEMS.map((item) => (
                <Command.Item
                  key={item.href}
                  value={`nav ${t(item.labelKey)}`}
                  onSelect={() => navigate(item.href)}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm aria-selected:bg-brand-50 aria-selected:text-brand-900"
                >
                  <item.icon className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="flex-1 text-gray-900">
                    {t(item.labelKey)}
                  </span>
                  <span className="hidden shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 sm:inline">
                    {t("palette.page")}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>

          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono">
                  ↑↓
                </kbd>
                {t("palette.navigate")}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono">
                  ↵
                </kbd>
                {t("palette.select")}
              </span>
            </div>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono">
                ⌘K
              </kbd>
              {t("palette.toggle")}
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
