import { formatPrepaidExpiry, isPrepaidExpired } from "@/lib/prepaid/expiry";
import { forecastPrepaid } from "@/lib/prepaid/forecast";

type Props = Parameters<typeof forecastPrepaid>[0];
const number = (value: number) =>
  value.toLocaleString("da-DK", { maximumFractionDigits: 1 });
const date = (value: string) =>
  formatPrepaidExpiry(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export function PrepaidForecast(props: Props) {
  const forecast = forecastPrepaid(props);
  const peak = Math.max(0, ...forecast.dailyUsage.map((day) => day.hours));
  const max = Math.max(1, peak);
  const unavailable =
    props.isActive === false
      ? "Kortet er deaktiveret. Der beregnes ingen slutdato."
      : isPrepaidExpired(props.expiryDate, props.now)
        ? "Kortet er udløbet. Der beregnes ingen slutdato."
        : props.remainingHours <= 0
          ? "Kortet er brugt op."
          : forecast.observedDays < 7
            ? "Prognosen vises, når kortet har mindst 7 dages historik."
            : forecast.consumedHours <= 0
              ? "Intet forbrug i perioden. Der kan endnu ikke beregnes en slutdato."
              : "Forbrugstakten er for lav til at beregne en slutdato.";
  return (
    <section
      aria-labelledby="prepaid-forecast-heading"
      className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
    >
      <h2
        id="prepaid-forecast-heading"
        className="text-lg font-semibold text-gray-900 dark:text-white"
      >
        Forbrug og prognose
      </h2>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Baseret på de seneste {forecast.observedDays} kalenderdage, inklusive
        dage uden forbrug. Tidsposter tæller på arbejdsdatoen, manuelle træk på
        registreringsdatoen.
      </p>
      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-gray-600 dark:text-gray-400">
            Gennemsnitligt forbrug
          </dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums text-gray-900 dark:text-white">
            {number(forecast.hoursPerWeek)} timer pr. uge
          </dd>
        </div>
        <div>
          <dt className="text-sm text-gray-600 dark:text-gray-400">
            Forventet brugt op
          </dt>
          <dd className="mt-1 text-gray-900 dark:text-white">
            {forecast.exhaustionDate
              ? `${date(forecast.exhaustionDate)} (om ca. ${forecast.daysRemaining} dage)`
              : unavailable}
          </dd>
        </div>
      </dl>
      {forecast.exhaustionDate && (
        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
          Et skøn ved uændret forbrug, uden fremtidige optankninger eller
          fornyelser.
        </p>
      )}
      {forecast.expiresBeforeExhaustion && props.expiryDate && (
        <p className="mt-3 text-sm font-medium text-amber-800 dark:text-amber-300">
          Kortets gyldighed udløber {formatPrepaidExpiry(props.expiryDate)} før
          den forventede slutdato.
        </p>
      )}
      {forecast.dailyUsage.length > 0 && (
        <>
          <figure className="mt-6">
            <figcaption className="mb-2 text-sm text-gray-600 dark:text-gray-400">
              Dagligt forbrug i timer. Højeste dag: {number(peak)} timer.
            </figcaption>
            <div
              aria-hidden="true"
              className="flex h-28 items-end gap-1 border-b border-gray-300 dark:border-gray-600"
            >
              {forecast.dailyUsage.map((day) => (
                <div
                  key={day.date}
                  className="min-w-0 flex-1 bg-brand-600 dark:bg-brand-400"
                  style={{ height: `${(Math.max(0, day.hours) / max) * 100}%` }}
                />
              ))}
            </div>
            <div
              aria-hidden="true"
              className="mt-2 flex justify-between text-xs text-gray-600 dark:text-gray-400"
            >
              <span>{date(forecast.dailyUsage[0].date)}</span>
              <span>
                {date(forecast.dailyUsage[forecast.dailyUsage.length - 1].date)}
              </span>
            </div>
          </figure>
          <details className="mt-4 text-sm text-gray-700 dark:text-gray-300">
            <summary className="min-h-6 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4">
              Se dagligt forbrug som tabel
            </summary>
            <table className="mt-2 w-full tabular-nums">
              <caption className="sr-only">
                Dagligt forbrug i prognoseperioden
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="text-left">
                    Dato
                  </th>
                  <th scope="col" className="text-right">
                    Timer
                  </th>
                </tr>
              </thead>
              <tbody>
                {forecast.dailyUsage.map((day) => (
                  <tr key={day.date}>
                    <th scope="row" className="py-1 text-left font-normal">
                      {date(day.date)}
                    </th>
                    <td className="text-right">{number(day.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
