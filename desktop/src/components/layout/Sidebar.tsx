import { useNavigate, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  CalendarDays,
  Clock,
  CreditCard,
  FileText,
  FolderOpen,
  LayoutDashboard,
  type LucideIcon,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/Tooltip";
import { useNarrowLayout } from "@/hooks/useNarrowLayout";
import { useSettingsStore } from "@/stores/settingsStore";

const navItems = [
  { path: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { path: "/calendar", icon: CalendarDays, labelKey: "nav.calendar" },
  { path: "/timeline", icon: Clock, labelKey: "nav.timeline" },
  { path: "/projects", icon: FolderOpen, labelKey: "nav.projects" },
  { path: "/klippekort", icon: CreditCard, labelKey: "nav.klippekort" },
  { path: "/invoices", icon: FileText, labelKey: "nav.invoices" },
  { path: "/reports", icon: BarChart3, labelKey: "nav.reports" },
] as const;

type SidebarLinkProps = {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  smal: boolean;
  visEtiketter: boolean;
};

function SidebarLink({
  to,
  label,
  icon: Icon,
  active,
  smal,
  visEtiketter,
}: SidebarLinkProps) {
  const navigate = useNavigate();

  const knap = (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      onClick={() => navigate({ to })}
      className={`flex h-10 w-full items-center rounded-lg text-sm transition-colors ${
        smal ? "justify-center" : "gap-3 px-3"
      } ${
        active
          ? "bg-(--color-accent) text-white"
          : "text-(--color-text-muted) hover:bg-(--color-border) hover:text-(--color-text)"
      }`}
    >
      <Icon size={18} className="shrink-0" />
      <AnimatePresence>
        {visEtiketter && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="whitespace-nowrap text-sm font-medium"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );

  // I et smalt vindue er der ingen plads til etiketten ved siden af ikonet,
  // så den ligger i en tooltip i stedet. Uden den er de otte rækker lige så
  // navnløse som et gadekort.
  if (smal) return <Tooltip label={label}>{knap}</Tooltip>;
  return knap;
}

export function Sidebar() {
  const { t } = useTranslation();
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;
  const { sidebarExpanded, toggleSidebar } = useSettingsStore();
  const smalt = useNarrowLayout();

  const isActive = (path: string) => {
    if (path === "/") return currentPath === "/";
    return currentPath.startsWith(path);
  };

  // Et smalt vindue må **ikke** udvide sig ved hover: de 164 px er præcis dem,
  // der skubber dagens kolonner ud af skærmen i et vindue på 900 px. Etiketten
  // flytter i stedet til en tooltip, så vejen stadig kan læses.
  const visEtiketter = sidebarExpanded && !smalt;

  return (
    // Bredden er en inline-værdi, ikke framer-motion's `animate`: en bredde der
    // kun findes i en animationsdriver er ikke til at aflæse — hverken af en
    // test eller i devtools, hvis en enkelt frame springes over. Overgangen er
    // CSS'en, så den er stadig de samme 200 ms.
    <aside
      aria-label={t("nav.dashboard")}
      style={{ width: smalt ? 56 : sidebarExpanded ? 220 : 56 }}
      className="flex shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface) transition-[width] duration-200 ease-in-out"
      onMouseEnter={() => {
        if (!smalt && !sidebarExpanded) toggleSidebar();
      }}
      onMouseLeave={() => {
        if (!smalt && sidebarExpanded) toggleSidebar();
      }}
    >
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {navItems.map(({ path, icon, labelKey }) => (
          <SidebarLink
            key={path}
            to={path}
            icon={icon}
            label={t(labelKey)}
            active={isActive(path)}
            smal={smalt}
            visEtiketter={visEtiketter}
          />
        ))}
      </nav>

      <div className="border-t border-(--color-border) p-2">
        <SidebarLink
          to="/settings"
          icon={Settings}
          label={t("nav.settings")}
          active={isActive("/settings")}
          smal={smalt}
          visEtiketter={visEtiketter}
        />
      </div>
    </aside>
  );
}
