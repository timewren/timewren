"use client";

interface FunnelStep {
  label: string;
  value: number;
  color?: string;
}

export function AdminFunnel({
  steps,
  isLoading = false,
}: {
  steps: FunnelStep[];
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => `funnel-skeleton-${i}`).map(
          (key) => (
            <div
              key={key}
              className="h-12 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"
            />
          ),
        )}
      </div>
    );
  }

  if (steps.length === 0) return null;

  const maxValue = Math.max(...steps.map((s) => s.value), 1);

  const defaultColors = [
    "bg-blue-500",
    "bg-cyan-500",
    "bg-teal-500",
    "bg-green-500",
    "bg-emerald-500",
    "bg-lime-500",
  ];

  return (
    <div className="space-y-3">
      {steps.map((step, i) => {
        const pct = Math.round((step.value / maxValue) * 100);
        const conversionPct =
          i > 0
            ? steps[i - 1].value > 0
              ? Math.round((step.value / steps[i - 1].value) * 100)
              : 0
            : 100;

        return (
          <div key={step.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {i + 1}. {step.label}
              </span>
              <div className="flex items-center gap-3">
                {i > 0 && (
                  <span className="text-xs text-gray-400">
                    {conversionPct}% konvertering
                  </span>
                )}
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  {step.value.toLocaleString("da-DK")}
                </span>
              </div>
            </div>
            <div className="h-8 w-full rounded-lg bg-gray-100 dark:bg-gray-700">
              <div
                className={`h-8 rounded-lg transition-all ${step.color ?? defaultColors[i % defaultColors.length]}`}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
