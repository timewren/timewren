"use client";

import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Award,
  BarChart3,
  BellRing,
  Briefcase,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clock,
  CreditCard,
  DollarSign,
  FileText,
  Flame,
  FolderKanban,
  Gauge,
  HeartPulse,
  Landmark,
  LayoutGrid,
  Mail,
  Palmtree,
  PieChart,
  Receipt,
  Scale,
  Search,
  Target,
  Ticket,
  Timer,
  TrendingDown,
  TrendingUp,
  Umbrella,
  UserCheck,
  UserMinus,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { WIDGET_CONFIGS, type WidgetType } from "@/types/dashboard";

const ICON_MAP: Record<
  string,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  Users,
  FolderKanban,
  Clock,
  DollarSign,
  CalendarClock,
  Mail,
  AlertCircle,
  Ticket,
  FileText,
  Activity,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Zap,
  Target,
  HeartPulse,
  Flame,
  PieChart,
  Calendar,
  CreditCard,
  Briefcase,
  Umbrella,
  UserCheck,
  Award,
  Scale,
  AlertTriangle,
  Wallet,
  Timer,
  Receipt,
  CalendarRange,
  Palmtree,
  Gauge,
  CalendarDays,
  BellRing,
  UserMinus,
  Landmark,
};

const CATEGORY_INFO: Record<string, { color: string }> = {
  stats: { color: "#3b82f6" },
  finance: { color: "#f59e0b" },
  tasks: { color: "#ef4444" },
  activity: { color: "#22c55e" },
  actions: { color: "#8b5cf6" },
  calendar: { color: "#6366f1" },
};

// Stable category display order
const CATEGORY_ORDER = [
  "stats",
  "finance",
  "tasks",
  "activity",
  "actions",
  "calendar",
];

interface WidgetCatalogProps {
  isOpen: boolean;
  onClose: () => void;
  availableWidgets: string[];
  onAddWidget: (widgetId: WidgetType) => void;
}

export function WidgetCatalog({
  isOpen,
  onClose,
  availableWidgets,
  onAddWidget,
}: WidgetCatalogProps) {
  const t = useTranslations("overview.catalog");
  const tWidget = useTranslations("overview.widget");
  const widgetTitle = (id: string, fallback: string) =>
    tWidget.has(`${id}.title`) ? tWidget(`${id}.title`) : fallback;
  const widgetDescription = (id: string, fallback: string) =>
    tWidget.has(`${id}.description`) ? tWidget(`${id}.description`) : fallback;
  const [search, setSearch] = useState("");
  // Controls the CSS transition — starts false so the panel slides in
  const [visible, setVisible] = useState(false);

  // Drive the slide-in animation when isOpen becomes true
  useEffect(() => {
    if (isOpen) {
      // Allow a frame for the closed-state to paint, then transition in
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Reset search when closed
  useEffect(() => {
    if (!isOpen) setSearch("");
  }, [isOpen]);

  // Build grouped data structure
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      { id: string; config: (typeof WIDGET_CONFIGS)[WidgetType] }[]
    >();
    for (const widgetId of availableWidgets) {
      const config = WIDGET_CONFIGS[widgetId as WidgetType];
      if (!config) continue;
      const cat = config.category;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)?.push({ id: widgetId, config });
    }
    return map;
  }, [availableWidgets]);

  // Filtered flat list for search
  // biome-ignore lint/correctness/useExhaustiveDependencies: widgetTitle og widgetDescription følger tWidget
  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return availableWidgets
      .map((id) => ({ id, config: WIDGET_CONFIGS[id as WidgetType] }))
      .filter(
        ({ id, config }) =>
          config &&
          (widgetTitle(id, config.title).toLowerCase().includes(q) ||
            widgetDescription(id, config.description)
              .toLowerCase()
              .includes(q)),
      );
  }, [search, availableWidgets, tWidget]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      {/* Backdrop */}
      <button
        type="button"
        className={`absolute inset-0 bg-black/30 dark:bg-black/50 transition-opacity duration-300 cursor-default ${visible ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-label={t("close")}
        tabIndex={-1}
      />

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 bottom-0 w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-xl flex flex-col transition-transform duration-300 ease-out ${visible ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t("title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("search")}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 pl-9 pr-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 focus:border-transparent"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 pb-5">
          {availableWidgets.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {t("allAdded")}
            </p>
          ) : searchResults ? (
            /* Flat search results */
            searchResults.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                {t("noMatch")}
              </p>
            ) : (
              <div className="space-y-0.5">
                {searchResults.map(({ id, config }) => {
                  const catInfo =
                    CATEGORY_INFO[config.category] ?? CATEGORY_INFO.stats;
                  const Icon = ICON_MAP[config.icon] ?? LayoutGrid;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onAddWidget(id as WidgetType)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: `${catInfo.color}15`,
                        }}
                      >
                        <Icon
                          className="h-4 w-4"
                          style={{ color: catInfo.color }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {widgetTitle(id, config.title)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {widgetDescription(id, config.description)}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                        +
                      </span>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            /* Grouped by category */
            <div className="space-y-4">
              {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => {
                const catInfo = CATEGORY_INFO[cat] ?? CATEGORY_INFO.stats;
                const items = grouped.get(cat);
                if (!items) return null;
                return (
                  <div key={cat}>
                    <div className="px-3 py-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                        {t(`category.${cat}`)}
                      </h4>
                    </div>
                    <div className="space-y-0.5">
                      {items.map(({ id, config }) => {
                        const Icon = ICON_MAP[config.icon] ?? LayoutGrid;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onAddWidget(id as WidgetType)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                              style={{
                                backgroundColor: `${catInfo.color}15`,
                              }}
                            >
                              <Icon
                                className="h-4 w-4"
                                style={{ color: catInfo.color }}
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                {widgetTitle(id, config.title)}
                              </p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {widgetDescription(id, config.description)}
                              </p>
                            </div>
                            <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                              +
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
