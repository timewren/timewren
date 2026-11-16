import type { ReactNode } from "react";

type WidgetVariant = "default" | "warning" | "danger" | "success" | "info";

interface DashboardWidgetProps {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  variant?: WidgetVariant;
}

const variantStyles: Record<WidgetVariant, { border: string; iconBg: string }> =
  {
    default: {
      border: "",
      iconBg: "bg-tt-flade",
    },
    warning: {
      border: "border-l-2 border-l-amber-400 dark:border-l-amber-500",
      iconBg: "bg-amber-100 dark:bg-amber-900/30",
    },
    danger: {
      border: "border-l-2 border-l-red-500 dark:border-l-red-400",
      iconBg: "bg-red-100 dark:bg-red-900/30",
    },
    success: {
      border: "border-l-2 border-l-green-500 dark:border-l-green-400",
      iconBg: "bg-green-100 dark:bg-green-900/30",
    },
    info: {
      border: "border-l-2 border-l-blue-500 dark:border-l-blue-400",
      iconBg: "bg-tt-flade",
    },
  };

export function DashboardWidget({
  title,
  children,
  icon,
  actions,
  className = "",
  variant = "default",
}: DashboardWidgetProps) {
  const styles = variantStyles[variant];

  return (
    <div
      className={`h-full rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex flex-col ${styles.border} ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {icon && (
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-lg ${styles.iconBg}`}
            >
              {icon}
            </div>
          )}
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {title}
          </h3>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Content. tabIndex gør det muligt at tastatur-scrolle, når indholdet
          er højere end widgeten (axe: scrollable-region-focusable).
          <section> med aria-label er implicit role="region". */}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable-region-focusable (axe) kræver tabIndex på selve scroll-containeren */}
      <section className="flex-1 overflow-auto" tabIndex={0} aria-label={title}>
        {children}
      </section>
    </div>
  );
}
