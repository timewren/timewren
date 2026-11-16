import Link from "next/link";
import { useTranslations } from "next-intl";
import type { NavItem } from "./navigation-config";

interface SidebarNavItemProps {
  item: NavItem;
  collapsed: boolean;
  isActive: boolean;
  onNavigate: () => void;
  variant?: "default" | "admin";
}

export function SidebarNavItem({
  item,
  collapsed,
  isActive,
  onNavigate,
  variant = "default",
}: SidebarNavItemProps) {
  const t = useTranslations("nav");

  const label = item.translationKey ? t(item.translationKey) : item.name;

  const activeStyles =
    variant === "admin"
      ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      : "bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400";

  const inactiveStyles =
    variant === "admin"
      ? "text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20 dark:hover:text-amber-300"
      : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white";

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-current={isActive ? "page" : undefined}
      data-tour={item.dataTour}
      className={`flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        isActive ? activeStyles : inactiveStyles
      } ${collapsed ? "justify-center" : "gap-2.5"}`}
    >
      <item.icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}
