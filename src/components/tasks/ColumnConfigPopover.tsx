"use client";

import { Columns3, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

type ListDensity = "compact" | "normal" | "detailed";

const ALL_COLUMNS = [
  { key: "status" },
  { key: "priority" },
  { key: "client" },
  { key: "project" },
  { key: "deadline" },
  { key: "estimate" },
  { key: "actualTime" },
  { key: "progress" },
  { key: "subtasks" },
  { key: "source" },
  { key: "createdAt" },
] as const;

const DENSITY_DEFAULTS: Record<ListDensity, string[]> = {
  compact: ["status", "priority", "client", "deadline"],
  normal: ["status", "priority", "client", "project", "deadline"],
  detailed: [
    "status",
    "priority",
    "client",
    "project",
    "deadline",
    "estimate",
    "createdAt",
  ],
};

interface ColumnConfigPopoverProps {
  visibleColumns: string[];
  onChange: (columns: string[]) => void;
  density: ListDensity;
}

export function ColumnConfigPopover({
  visibleColumns,
  onChange,
  density,
}: ColumnConfigPopoverProps) {
  const t = useTranslations("tasks");
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleColumn = (key: string) => {
    if (visibleColumns.includes(key)) {
      onChange(visibleColumns.filter((c) => c !== key));
    } else {
      onChange([...visibleColumns, key]);
    }
  };

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
      >
        <Columns3 className="h-3.5 w-3.5" />
        {t("columns.button")}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            {t("columns.visible")}
          </div>
          <div className="space-y-1">
            {ALL_COLUMNS.map(({ key }) => (
              <label
                key={key}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
              >
                <input
                  type="checkbox"
                  checked={visibleColumns.includes(key)}
                  onChange={() => toggleColumn(key)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                />
                {t(`columns.${key}`)}
              </label>
            ))}
          </div>
          <div className="border-t border-gray-100 dark:border-gray-700 mt-2 pt-2">
            <button
              type="button"
              onClick={() => onChange(DENSITY_DEFAULTS[density])}
              className="flex items-center gap-1.5 w-full justify-center rounded-md px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              {t("columns.reset")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { ALL_COLUMNS, DENSITY_DEFAULTS };
