"use client";

import { AlignJustify, LayoutList, SquareStack } from "lucide-react";
import { useTranslations } from "next-intl";

type ListDensity = "compact" | "normal" | "detailed";

interface DensityToggleProps {
  value: ListDensity;
  onChange: (density: ListDensity) => void;
}

const densityOptions: {
  key: ListDensity;
  icon: typeof AlignJustify;
}[] = [
  { key: "compact", icon: AlignJustify },
  { key: "normal", icon: LayoutList },
  { key: "detailed", icon: SquareStack },
];

export function DensityToggle({ value, onChange }: DensityToggleProps) {
  const t = useTranslations("tasks");
  return (
    <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
      {densityOptions.map(({ key, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          title={t(`density.${key}`)}
          className={`
            flex items-center justify-center p-1.5 rounded-md transition-colors
            ${
              value === key
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
            }
          `}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
