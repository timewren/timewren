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
  partTimeHours = [],
}: {
  year: number;
  hoursPerWeek?: number;
  caption?: string;
  partTimeHours?: number[];
}) {
  const months: MonthSummary[] = workdaysByMonth(year, hoursPerWeek);
  const totalDays = months.reduce((s, m) => s + m.workdays, 0);
  const totalHours = months.reduce((s, m) => s + m.hours, 0);
  const totalCommon = months.reduce((s, m) => s + m.commonDaysOff, 0);

  const minWidth = partTimeHours.length ? "min-w-[39rem]" : "min-w-[24rem]";

  return (
    <div className="overflow-x-auto rounded-[14px] border border-tt-streg">
      <table className={`w-full ${minWidth} text-left text-sm`}>
        {caption ? (
          <caption className="border-b border-tt-streg bg-tt-flade px-5 py-3 text-left font-semibold text-tt-blaek">
            {caption}
          </caption>
        ) : null}
        <thead className="border-b border-tt-streg text-tt-graa">
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
            {partTimeHours.map((hours) => (
              <th
                key={hours}
                scope="col"
                className="px-5 py-3 text-right font-medium"
              >
                Timer ved {hours} t/uge
              </th>
            ))}
            <th scope="col" className="px-5 py-3 text-right font-medium">
              Almindelige fridage*
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-tt-streg">
          {months.map((m) => (
            <tr key={m.month}>
              <th scope="row" className="px-5 py-2.5 font-medium text-tt-blaek">
                {m.name}
              </th>
              <td className="px-5 py-2.5 text-right tabular-nums">
                {m.workdays}
              </td>
              <td className="px-5 py-2.5 text-right tabular-nums">
                {formatHours(m.hours)}
              </td>
              {partTimeHours.map((hours) => (
                <td key={hours} className="px-5 py-2.5 text-right tabular-nums">
                  {formatHours((m.workdays * hours) / 5)}
                </td>
              ))}
              <td className="px-5 py-2.5 text-right tabular-nums text-tt-graa">
                {m.commonDaysOff || "–"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-tt-streg bg-tt-flade font-semibold text-tt-blaek">
          <tr>
            <th scope="row" className="px-5 py-3">
              {year} i alt
            </th>
            <td className="px-5 py-3 text-right tabular-nums">{totalDays}</td>
            <td className="px-5 py-3 text-right tabular-nums">
              {formatHours(totalHours)}
            </td>
            {partTimeHours.map((hours) => (
              <td key={hours} className="px-5 py-3 text-right tabular-nums">
                {formatHours((totalDays * hours) / 5)}
              </td>
            ))}
            <td className="px-5 py-3 text-right tabular-nums">{totalCommon}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
