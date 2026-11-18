import {
  MONTH_NAMES,
  officialHolidays,
  weekdayOf,
} from "@/lib/marketing/workdays";
import { mk } from "./mk";
import { WorkdaysTable } from "./WorkdaysTable";

export function MonthlyWorkHours({ year }: { year: number }) {
  return (
    <section id={`timer-${year}`} className="mt-10 max-w-4xl scroll-mt-24">
      <h2 className={mk.h2}>Arbejdstimer pr. måned i {year}</h2>
      <div className="mt-4">
        <WorkdaysTable year={year} partTimeHours={[32, 30]} />
      </div>
      <details className="mt-4 rounded-lg border border-tt-streg px-4">
        <summary className="cursor-pointer py-3 font-medium">
          Helligdage på hverdage i {year}
        </summary>
        <ul className={`${mk.fine} space-y-1 px-4 pb-4`}>
          {officialHolidays(year)
            .filter(({ date }) => weekdayOf(date) > 0 && weekdayOf(date) < 6)
            .map(({ date, name }) => (
              <li key={date}>
                {Number(date.slice(8))}.{" "}
                {MONTH_NAMES[Number(date.slice(5, 7)) - 1].toLowerCase()} (
                {name})
              </li>
            ))}
        </ul>
      </details>
    </section>
  );
}
