"use client";

import { ChevronRight, Home } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { routeLabels } from "./navigation-config";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useAutoBreadcrumbs(
  dynamicLabels?: Record<string, string>,
): BreadcrumbItem[] {
  const pathname = usePathname();
  const t = useTranslations("shell");

  return useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);

    // Skip if we're at /dashboard (top-level, no breadcrumbs needed)
    // or only one level deep (e.g. /dashboard/clients)
    if (segments.length <= 2) return [];

    const items: BreadcrumbItem[] = [];

    // Build breadcrumb for each segment after "dashboard"
    for (let i = 1; i < segments.length; i++) {
      const segment = segments[i];
      const href = `/${segments.slice(0, i + 1).join("/")}`;
      const isLast = i === segments.length - 1;

      let label: string;
      if (dynamicLabels?.[segment]) {
        label = dynamicLabels[segment];
      } else if (UUID_REGEX.test(segment)) {
        label = dynamicLabels?.[segment] || "...";
      } else {
        label =
          /^[a-z-]+$/.test(segment) && t.has(`routes.${segment}`)
            ? t(`routes.${segment}`)
            : routeLabels[segment] || segment;
      }

      items.push({
        label,
        href: isLast ? undefined : href,
      });
    }

    return items;
  }, [pathname, dynamicLabels, t]);
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  const t = useTranslations("shell");
  if (items.length === 0) return null;

  return (
    <nav
      aria-label={t("breadcrumbLabel")}
      className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400"
    >
      <Link
        href="/dashboard"
        className="hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
      >
        <Home className="h-4 w-4" />
      </Link>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <ChevronRight className="h-3.5 w-3.5" />
          {item.href ? (
            <Link
              href={item.href}
              className="hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-gray-900 dark:text-white font-medium">
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
