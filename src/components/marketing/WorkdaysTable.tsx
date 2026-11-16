import {
  formatHours,
  type MonthSummary,
  workdaysByMonth,
} from "@/lib/marketing/workdays";

/** Arbejdsdage og -timer pr. måned for et år (server-renderet tabel). */
export function WorkdaysTable({
  year,
  hoursPerWeek = 37,
  caption,
}: {
  year: number;
  hoursPerWeek?: number;
  caption?: string;
}) {
  const months: MonthSummary[] = workdaysByMonth(year, hoursPerWeek);
  const totalDays = months.reduce((s, m) => s + m.workdays, 0);
  const totalHours = months.reduce((s, m) => s + m.hours, 0);
  const totalCommon = months.reduce((s, m) => s + m.commonDaysOff, 0);

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-200">
      <table className="w-full min-w-[32rem] text-left text-sm">
        {caption ? (
          <caption className="border-b border-gray-200 bg-gray-50 px-5 py-3 text-left font-semibold text-gray-900">
            {caption}
          </caption>
        ) : null}
        <thead className="border-b border-gray-200 text-gray-600">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">
              Måned
            </th>
            <th scope="col" className="px-5 py-3 text-right font-medium">
              Arbejdsdage
            </th>
            <th scope="col" className="px-5 py-3 text-right font-medium">
              Timer ved {hoursPerWeek} t/uge
            </th>
            <th scope="col" className="px-5 py-3 text-right font-medium">
              Almindelige fridage*
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row" className="px-5 py-2.5 font-medium text-gray-900">
                {m.name}
              </th>
              <td className="px-5 py-2.5 text-right tabular-nums">
                {m.workdays}
              </td>
              <td className="px-5 py-2.5 text-right tabular-nums">
                {formatHours(m.hours)}
              </td>
              <td className="px-5 py-2.5 text-right tabular-nums text-gray-500">
                {m.commonDaysOff || "–"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
          <tr>
            <th scope="row" className="px-5 py-3">
              {year} i alt
            </th>
            <td className="px-5 py-3 text-right tabular-nums">{totalDays}</td>
            <td className="px-5 py-3 text-right tabular-nums">
              {formatHours(totalHours)}
            </td>
            <td className="px-5 py-3 text-right tabular-nums">{totalCommon}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
