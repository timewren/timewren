import { Calendar, Clock, CreditCard, History } from "lucide-react";
import { useT } from "../../i18n";
import { tabKeyTarget } from "../../lib/tablist";

export type PopupTab = "timer" | "calendar" | "history" | "prepaid";

interface TabBarProps {
  activeTab: PopupTab;
  onTabChange: (tab: PopupTab) => void;
  /** Faner der er slået fra i Indstillinger */
  hiddenTabs?: PopupTab[];
}

const TABS: { id: PopupTab; icon: typeof Clock }[] = [
  { id: "timer", icon: Clock },
  { id: "calendar", icon: Calendar },
  { id: "history", icon: History },
  { id: "prepaid", icon: CreditCard },
];

export const POPUP_TABPANEL_ID = "popup-fanepanel";
export const popupTabId = (tab: PopupTab) => `popup-fane-${tab}`;

export function TabBar({
  activeTab,
  onTabChange,
  hiddenTabs = [],
}: TabBarProps) {
  const { t } = useT();
  const visible = TABS.filter((tab) => !hiddenTabs.includes(tab.id));
  return (
    <div
      role="tablist"
      aria-label={t("popup.tabs.view")}
      className="flex gap-1 bg-[var(--color-surface-sunken)] rounded-lg p-0.5 mx-3 mb-2"
    >
      {visible.map((tab, i) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            id={popupTabId(tab.id)}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={POPUP_TABPANEL_ID}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => {
              const next = tabKeyTarget(visible.length, i, e.key);
              if (next === null) return;
              e.preventDefault();
              onTabChange(visible[next].id);
              document.getElementById(popupTabId(visible[next].id))?.focus();
            }}
            className={`flex-1 flex items-center justify-center gap-1 min-h-7 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
              isActive
                ? "bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            <Icon size={12} aria-hidden="true" />
            {t(`popup.tabs.${tab.id}`)}
          </button>
        );
      })}
    </div>
  );
}
