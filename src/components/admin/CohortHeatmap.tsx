"use client";

type CohortData = {
  month: string;
  cohortSize: number;
  retention: Array<{
    monthOffset: number;
    activeCount: number;
    percentage: number;
  }>;
};

const DANISH_MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "maj",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

function formatCohortMonth(yyyyMm: string): string {
  const [year, month] = yyyyMm.split("-");
  const monthIndex = Number.parseInt(month, 10) - 1;
  return `${DANISH_MONTHS[monthIndex]} ${year}`;
}

function getCellColor(percentage: number): string {
  if (percentage >= 80) return "bg-green-600 text-white dark:bg-green-500";
  if (percentage >= 60) return "bg-green-400 text-white dark:bg-green-400";
  if (percentage >= 40)
    return "bg-yellow-400 text-gray-900 dark:bg-yellow-500 dark:text-gray-900";
  if (percentage >= 20) return "bg-orange-400 text-white dark:bg-orange-500";
  if (percentage > 0) return "bg-red-400 text-white dark:bg-red-500";
  return "bg-red-600 text-white dark:bg-red-600";
}

export function CohortHeatmap({ cohorts }: { cohorts: CohortData[] }) {
  if (cohorts.length === 0) {
    return null;
  }

  // Find the maximum month offset across all cohorts
  const maxOffset = cohorts.reduce((max, c) => {
    const cohortMax = c.retention.reduce(
      (m, r) => Math.max(m, r.monthOffset),
      0,
    );
    return Math.max(max, cohortMax);
  }, 0);

  const headers = Array.from({ length: maxOffset + 1 }, (_, i) => `M${i}`);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:bg-gray-900 dark:text-gray-400">
              Kohorte
            </th>
            {headers.map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-center text-xs font-medium uppercase text-gray-500 dark:text-gray-400"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => {
            const retentionMap = new Map(
              cohort.retention.map((r) => [r.monthOffset, r]),
            );

            return (
              <tr
                key={cohort.month}
                className="border-t border-gray-200 dark:border-gray-700"
              >
                <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2 font-medium text-gray-900 dark:bg-gray-900 dark:text-gray-100">
                  {formatCohortMonth(cohort.month)}{" "}
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({cohort.cohortSize})
                  </span>
                </td>
                {headers.map((_, i) => {
                  const r = retentionMap.get(i);
                  if (!r) {
                    return (
                      <td
                        // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                        key={`${cohort.month}-${i}`}
                        className="px-3 py-2 text-center text-gray-300 dark:text-gray-600"
                      >
                        -
                      </td>
                    );
                  }
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                    <td key={`${cohort.month}-${i}`} className="px-1 py-1">
                      <div
                        className={`group relative mx-auto flex h-8 w-14 items-center justify-center rounded text-xs font-semibold ${getCellColor(r.percentage)}`}
                        title={`${r.activeCount}/${cohort.cohortSize} brugere aktive`}
                      >
                        {r.percentage}%
                        <div className="pointer-events-none absolute -top-8 left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg group-hover:block dark:bg-gray-700">
                          {r.activeCount}/{cohort.cohortSize} brugere aktive
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
