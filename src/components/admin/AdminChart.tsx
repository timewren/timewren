"use client";

import { InlineSpinner } from "@/components/ui/LoadingScreen";

interface BarData {
  label: string;
  value: number;
  /** Optional secondary value shown as a lighter stacked segment on top */
  secondaryValue?: number;
  displayValue?: string;
  secondaryDisplayValue?: string;
}

export function AdminChart({
  data,
  color = "blue",
  secondaryColor,
  height = 256,
  emptyMessage = "Ingen data endnu",
  isLoading = false,
  legend,
}: {
  data: BarData[];
  color?: "blue" | "green" | "amber" | "purple" | "rose";
  secondaryColor?: "blue" | "green" | "amber" | "purple" | "rose";
  height?: number;
  emptyMessage?: string;
  isLoading?: boolean;
  legend?: { primary: string; secondary: string };
}) {
  const colorMap = {
    blue: "bg-blue-500 hover:bg-blue-600",
    green: "bg-green-500 hover:bg-green-600",
    amber: "bg-amber-500 hover:bg-amber-600",
    purple: "bg-purple-500 hover:bg-purple-600",
    rose: "bg-rose-500 hover:bg-rose-600",
  } as const;

  const secondaryColorMap = {
    blue: "bg-blue-300/60 dark:bg-blue-400/40",
    green: "bg-green-300/60 dark:bg-green-400/40",
    amber: "bg-amber-300/60 dark:bg-amber-400/40",
    purple: "bg-purple-300/60 dark:bg-purple-400/40",
    rose: "bg-rose-300/60 dark:bg-rose-400/40",
  } as const;

  const legendDotMap = {
    blue: "bg-blue-500",
    green: "bg-green-500",
    amber: "bg-amber-500",
    purple: "bg-purple-500",
    rose: "bg-rose-500",
  } as const;

  const secondaryLegendDotMap = {
    blue: "bg-blue-300",
    green: "bg-green-300",
    amber: "bg-amber-300",
    purple: "bg-purple-300",
    rose: "bg-rose-300",
  } as const;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <InlineSpinner className="h-8 w-8" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-gray-500"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    );
  }

  const hasSecondary = data.some(
    (d) => d.secondaryValue && d.secondaryValue > 0,
  );
  const maxValue = Math.max(
    ...data.map((d) =>
      hasSecondary && d.secondaryValue ? d.secondaryValue : d.value,
    ),
    1,
  );
  const barHeight = height - 56; // space for labels
  const secColor = secondaryColor || color;

  return (
    <div>
      {legend && hasSecondary && (
        <div className="mb-2 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-sm ${legendDotMap[color]}`}
            />
            {legend.primary}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-sm ${secondaryLegendDotMap[secColor]}`}
            />
            {legend.secondary}
          </span>
        </div>
      )}
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((item) => {
          const primaryHeight = (item.value / maxValue) * barHeight;
          const secondaryExtra =
            hasSecondary &&
            item.secondaryValue &&
            item.secondaryValue > item.value
              ? ((item.secondaryValue - item.value) / maxValue) * barHeight
              : 0;

          return (
            <div
              key={item.label}
              className="group flex flex-1 flex-col items-center"
            >
              {/* Secondary (potential) segment on top */}
              {secondaryExtra > 0 && (
                <div
                  className={`w-full border-b-2 border-dashed border-white/50 dark:border-gray-800/50 transition-all ${secondaryColorMap[secColor]}`}
                  style={{
                    height: `${secondaryExtra}px`,
                    borderTopLeftRadius: "0.25rem",
                    borderTopRightRadius: "0.25rem",
                  }}
                />
              )}
              {/* Primary bar */}
              <div
                className={`w-full transition-all ${colorMap[color]} ${secondaryExtra > 0 ? "" : "rounded-t"}`}
                style={{
                  height: `${primaryHeight}px`,
                  minHeight: item.value > 0 ? "4px" : "0",
                }}
              />
              <span className="mt-2 text-xs text-gray-500">{item.label}</span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {item.displayValue ?? item.value}
              </span>
              {hasSecondary &&
                item.secondaryDisplayValue &&
                secondaryExtra > 0 && (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    +{item.secondaryDisplayValue}
                  </span>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AdminProgressBar({
  label,
  value,
  max,
  color = "blue",
}: {
  label: string;
  value: number;
  max: number;
  color?: "blue" | "green" | "amber" | "purple" | "rose";
}) {
  const colorMap = {
    blue: "bg-blue-500",
    green: "bg-green-500",
    amber: "bg-amber-500",
    purple: "bg-purple-500",
    rose: "bg-rose-500",
  } as const;

  const pct = max > 0 ? Math.round((value / max) * 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-700 dark:text-gray-300">{label}</span>
        <span className="font-medium text-gray-900 dark:text-white">
          {value} / {max} ({pct}%)
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-700">
        <div
          className={`h-2 rounded-full transition-all ${colorMap[color]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
