"use client";

import { Calculator, Info } from "lucide-react";
import { useState } from "react";

const PACKAGE_PRESETS = [5, 10, 20] as const;

/**
 * Klippekort-prisberegner: hvad skal din timepakke koste? Kerneprodukt-nær
 * lead magnet (issue #105) — fører direkte ind i klippekort-differentiatoren.
 */
export function KlippekortPrisBeregner() {
  const [hourlyRate, setHourlyRate] = useState(850);
  const [packageHours, setPackageHours] = useState(10);
  const [discountPercent, setDiscountPercent] = useState(10);

  const listPrice = hourlyRate * packageHours;
  const packagePrice = listPrice * (1 - discountPercent / 100);
  const effectiveRate = packageHours > 0 ? packagePrice / packageHours : 0;
  const customerSaving = listPrice - packagePrice;
  const packagePriceInclMoms = packagePrice * 1.25;

  // Tommelfingerregel: rabatten skal modsvares af værdien af forudbetaling
  // (likviditet + ingen debitor-risiko + committet kunde).
  const suggestedDiscount =
    packageHours >= 20 ? 15 : packageHours >= 10 ? 10 : 5;

  const formatDKK = (n: number) =>
    n.toLocaleString("da-DK", {
      style: "currency",
      currency: "DKK",
      maximumFractionDigits: 0,
    });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="grid gap-6 md:grid-cols-2">
        {/* Input form */}
        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <h3 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Calculator className="h-5 w-5 text-brand-600" />
            Dit klippekort
          </h3>

          <div className="space-y-5">
            <div>
              <label
                htmlFor="kk-rate"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Din normale timepris (ekskl. moms)
              </label>
              <div className="relative">
                <input
                  id="kk-rate"
                  type="number"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(Number(e.target.value))}
                  min={0}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 pr-12 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                  kr/t
                </span>
              </div>
            </div>

            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Timer i pakken
              </span>
              <div className="flex gap-2">
                {PACKAGE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setPackageHours(preset)}
                    className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${
                      packageHours === preset
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {preset} timer
                  </button>
                ))}
              </div>
              <input
                id="kk-hours"
                type="number"
                aria-label="Timer i pakken (frit antal)"
                value={packageHours}
                onChange={(e) => setPackageHours(Number(e.target.value))}
                min={1}
                max={200}
                className="mt-2 w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label
                htmlFor="kk-discount"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Rabat for forudbetaling: {discountPercent}%
              </label>
              <input
                id="kk-discount"
                type="range"
                value={discountPercent}
                onChange={(e) => setDiscountPercent(Number(e.target.value))}
                min={0}
                max={30}
                step={1}
                className="w-full accent-brand-600"
              />
              {discountPercent !== suggestedDiscount && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Tommelfingerregel for {packageHours} timer: ca.{" "}
                  {suggestedDiscount}%. Forudbetalingen er rabatten værd
                  (likviditet, ingen rykkere, committet kunde).
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-6">
          <h3 className="mb-6 text-lg font-semibold text-slate-900">
            Dit klippekort
          </h3>
          <dl className="space-y-4">
            <div>
              <dt className="text-sm text-slate-600">
                Pakkepris (ekskl. moms)
              </dt>
              <dd className="text-3xl font-bold text-brand-700">
                {formatDKK(packagePrice)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-slate-600">Pakkepris inkl. moms</dt>
              <dd className="text-xl font-semibold text-slate-900">
                {formatDKK(packagePriceInclMoms)}
              </dd>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-brand-200 pt-4">
              <div>
                <dt className="text-sm text-slate-600">Effektiv timepris</dt>
                <dd className="text-lg font-semibold text-slate-900">
                  {formatDKK(effectiveRate)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-600">Kundens besparelse</dt>
                <dd className="text-lg font-semibold text-green-700">
                  {formatDKK(customerSaving)}
                </dd>
              </div>
            </div>
          </dl>
          <p className="mt-6 text-xs text-slate-500">
            Salgsargumentet til kunden: "{packageHours} timer til{" "}
            {formatDKK(packagePrice)}, og du sparer {formatDKK(customerSaving)}{" "}
            i forhold til timepris." Du får pengene på forhånd og slipper for
            rykkere.
          </p>
        </div>
      </div>
    </div>
  );
}
