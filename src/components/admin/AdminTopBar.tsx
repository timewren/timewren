"use client";

import { ArrowLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const pageTitles: Record<string, string> = {
  "/admin": "nav.dashboard",
  "/admin/users": "nav.users",
  "/admin/finance": "nav.finance",
  "/admin/analytics": "nav.analytics",
  "/admin/activity": "nav.activity",
  "/admin/monitoring": "nav.monitoring",
  "/admin/stabilitet": "nav.stability",
  "/admin/broadcasts": "nav.broadcasts",
  "/admin/email-forwarding": "nav.emailForwarding",
  "/admin/support": "nav.support",
  "/admin/help-feedback": "nav.helpFeedback",
  "/admin/roadmap": "nav.roadmap",
  "/admin/settings": "nav.settings",
};

interface AdminTopBarProps {
  onOpenSearch?: () => void;
}

export function AdminTopBar({ onOpenSearch }: AdminTopBarProps) {
  const t = useTranslations("adminShell");
  const pathname = usePathname();

  // Build breadcrumbs
  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs: { label: string; href: string }[] = [
    { label: t("topbar.admin"), href: "/admin" },
  ];

  if (segments.length > 1) {
    const pagePath = `/${segments.slice(0, 2).join("/")}`;
    const pageTitleKey = pageTitles[pagePath];
    if (pageTitleKey && pagePath !== "/admin") {
      breadcrumbs.push({ label: t(pageTitleKey), href: pagePath });
    }
  }

  // If there's a dynamic segment (e.g., /admin/users/[userId])
  if (segments.length > 2) {
    breadcrumbs.push({
      label: segments[segments.length - 1],
      href: pathname,
    });
  }

  return (
    <div className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1.5 text-sm">
        {breadcrumbs.map((crumb, index) => (
          <span key={crumb.href} className="flex items-center gap-1.5">
            {index > 0 && (
              <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
            )}
            {index === breadcrumbs.length - 1 ? (
              <span className="font-medium text-gray-900">{crumb.label}</span>
            ) : (
              <Link
                href={crumb.href}
                className="text-gray-500 hover:text-gray-700"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {onOpenSearch && (
          <button
            type="button"
            onClick={onOpenSearch}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
            title={t("topbar.searchTitle")}
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t("topbar.search")}</span>
            <kbd className="hidden rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-500 sm:inline">
              ⌘K
            </kbd>
          </button>
        )}
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t("topbar.backToApp")}
        </Link>
      </div>
    </div>
  );
}
