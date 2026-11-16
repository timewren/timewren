import { useTranslations } from "next-intl";
import type { NavGroup } from "./navigation-config";
import { SidebarNavItem } from "./SidebarNavItem";

interface SidebarNavGroupProps {
  group: NavGroup;
  collapsed: boolean;
  pathname: string;
  onNavigate: () => void;
}

export function SidebarNavGroup({
  group,
  collapsed,
  pathname,
  onNavigate,
}: SidebarNavGroupProps) {
  const t = useTranslations("nav");

  if (group.items.length === 0) return null;

  const groupLabel = group.labelTranslationKey
    ? t(group.labelTranslationKey)
    : group.label;

  return (
    <div>
      {groupLabel &&
        (collapsed ? (
          <div className="mx-3 my-2 border-t border-gray-200 dark:border-gray-700" />
        ) : (
          <p className="mb-0.5 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
            {groupLabel}
          </p>
        ))}
      <div className="space-y-0.5">
        {group.items.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <SidebarNavItem
              key={item.href}
              item={item}
              collapsed={collapsed}
              isActive={isActive}
              onNavigate={onNavigate}
            />
          );
        })}
      </div>
    </div>
  );
}
