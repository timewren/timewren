"use client";

import {
  Activity,
  ArrowLeft,
  BarChart3,
  Beaker,
  ChevronLeft,
  ChevronRight,
  Laptop,
  LayoutDashboard,
  Mail,
  MailQuestion,
  Map as MapIcon,
  MessageSquare,
  MessageSquareHeart,
  MessageSquarePlus,
  Monitor,
  Settings,
  Shield,
  ShieldAlert,
  TrendingUp,
  Users,
  Wallet,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useBrand } from "@/components/BrandContext";
import { trpc } from "@/providers/trpc-provider";

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ElementType;
}

interface NavSection {
  headingKey: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    headingKey: "sections.insights",
    items: [
      { href: "/admin", labelKey: "nav.dashboard", icon: LayoutDashboard },
      { href: "/admin/users", labelKey: "nav.users", icon: Users },
      { href: "/admin/prospects", labelKey: "nav.prospects", icon: Beaker },
      { href: "/admin/support", labelKey: "nav.support", icon: MessageSquare },
      { href: "/admin/finance", labelKey: "nav.finance", icon: Wallet },
    ],
  },
  {
    headingKey: "sections.growth",
    items: [
      { href: "/admin/growth", labelKey: "nav.growth", icon: TrendingUp },
      { href: "/admin/analytics", labelKey: "nav.analytics", icon: BarChart3 },
      { href: "/admin/broadcasts", labelKey: "nav.broadcasts", icon: Mail },
    ],
  },
  {
    headingKey: "sections.operations",
    items: [
      { href: "/admin/monitoring", labelKey: "nav.monitoring", icon: Monitor },
      {
        href: "/admin/stabilitet",
        labelKey: "nav.stability",
        icon: ShieldAlert,
      },
      { href: "/admin/desktop", labelKey: "nav.desktop", icon: Laptop },
      { href: "/admin/webhooks", labelKey: "nav.webhooks", icon: Webhook },
      {
        href: "/admin/email-forwarding",
        labelKey: "nav.emailForwarding",
        icon: MailQuestion,
      },
    ],
  },
  {
    headingKey: "sections.compliance",
    items: [
      { href: "/admin/compliance", labelKey: "nav.compliance", icon: Shield },
    ],
  },
  {
    headingKey: "sections.system",
    items: [
      {
        href: "/admin/feedback",
        labelKey: "nav.userFeedback",
        icon: MessageSquarePlus,
      },
      {
        href: "/admin/help-feedback",
        labelKey: "nav.helpFeedback",
        icon: MessageSquareHeart,
      },
      { href: "/admin/roadmap", labelKey: "nav.roadmap", icon: MapIcon },
      { href: "/admin/activity", labelKey: "nav.activity", icon: Activity },
      { href: "/admin/settings", labelKey: "nav.settings", icon: Settings },
    ],
  },
];

interface AdminSidebarProps {
  userName: string;
  userRole: string;
  onOpenSearch?: () => void;
}

export function AdminSidebar({
  userName,
  userRole,
  onOpenSearch: _onOpenSearch,
}: AdminSidebarProps) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("adminShell");
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const { data: supportCounts } = trpc.admin.counts.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const openTicketCount = supportCounts?.open ?? 0;

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  };

  const getBadge = (href: string): number | null => {
    if (href === "/admin/support" && openTicketCount > 0)
      return openTicketCount;
    return null;
  };

  return (
    <aside
      className={`flex h-screen flex-col border-r border-gray-200 bg-white transition-all duration-200 ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-gray-200 px-4">
        {!collapsed && (
          <span className="text-sm font-semibold text-gray-900">
            {t("sidebar.title", { brand: brand.name })}
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {navSections.map((section) => (
          <div key={section.headingKey}>
            {!collapsed && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {t(section.headingKey)}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                const badge = getBadge(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? t(item.labelKey) : undefined}
                    className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "border-l-2 border-brand-600 bg-brand-50 text-brand-600"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                    } ${collapsed ? "justify-center px-2" : ""}`}
                  >
                    <item.icon
                      className={`h-4.5 w-4.5 shrink-0 ${active ? "text-brand-600" : "text-gray-400"}`}
                    />
                    {!collapsed && (
                      <>
                        <span className="flex-1">{t(item.labelKey)}</span>
                        {badge !== null && (
                          <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-xs font-medium text-white">
                            {badge}
                          </span>
                        )}
                      </>
                    )}
                    {collapsed && badge !== null && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
                        {badge > 9 ? "9+" : badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-200 p-3">
        {!collapsed && (
          <div className="mb-3 px-1">
            <p className="truncate text-sm font-medium text-gray-900">
              {userName}
            </p>
            <span
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                userRole === "admin"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-brand-100 text-brand-700"
              }`}
            >
              {userRole === "admin"
                ? t("sidebar.roleAdmin")
                : t("sidebar.roleSupporter")}
            </span>
          </div>
        )}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700"
          title={
            collapsed ? t("sidebar.backTo", { brand: brand.name }) : undefined
          }
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          {!collapsed && (
            <span>{t("sidebar.backTo", { brand: brand.name })}</span>
          )}
        </Link>
      </div>
    </aside>
  );
}
