"use client";

import { ArrowDownUp, Info } from "lucide-react";
import { useState } from "react";

type Direction = "exToIncl" | "inclToEx";

export function MomsBeregner() {
  const [amount, setAmount] = useState(1000);
  const [direction, setDirection] = useState<Direction>("exToIncl");
  const MOMS_RATE = 0.25;

  let exMoms: number;
  let momsAmount: number;
  let inclMoms: number;

  if (direction === "exToIncl") {
    exMoms = amount;
    momsAmount = amount * MOMS_RATE;
    inclMoms = amount + momsAmount;
  } else {
    inclMoms = amount;
    exMoms = amount / (1 + MOMS_RATE);
    momsAmount = inclMoms - exMoms;
  }

  const formatDKK = (n: number) =>
    n.toLocaleString("da-DK", {
      style: "currency",
      currency: "DKK",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const toggleDirection = () => {
    if (direction === "exToIncl") {
      setDirection("inclToEx");
      setAmount(Math.round(inclMoms * 100) / 100);
    } else {
      setDirection("exToIncl");
      setAmount(Math.round(exMoms * 100) / 100);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm sm:p-8">
        {/* Direction toggle */}
        <div className="mb-6 flex items-center justify-center">
          <button
            type="button"
            onClick={toggleDirection}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-5 py-2.5 text-sm font-medium text-slate-700 transition-all hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
          >
            <ArrowDownUp className="h-4 w-4" />
            {direction === "exToIncl"
              ? "Beregn fra beløb ekskl. moms"
              : "Beregn fra beløb inkl. moms"}
          </button>
        </div>

        {/* Input */}
        <div className="mb-8">
          <label
            htmlFor="mb-amount"
            className="mb-2 block text-sm font-medium text-slate-700"
          >
            {direction === "exToIncl"
              ? "Beløb ekskl. moms"
              : "Beløb inkl. moms"}
          </label>
          <div className="relative">
            <input
              id="mb-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              step={0.01}
              className="w-full rounded-xl border border-slate-300 px-4 py-4 text-2xl font-bold text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-lg text-slate-400">
              kr
            </span>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-4 rounded-xl bg-slate-50 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">Beløb ekskl. moms</span>
            <span
              className={`text-lg font-semibold ${
                direction === "exToIncl" ? "text-slate-500" : "text-slate-900"
              }`}
            >
              {formatDKK(exMoms)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-600">Moms (25%)</span>
            <span className="text-lg font-semibold text-brand-600">
              {formatDKK(momsAmount)}
            </span>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <span className="text-sm font-medium text-slate-700">
              Beløb inkl. moms
            </span>
            <span
              className={`text-2xl font-bold ${
                direction === "inclToEx" ? "text-slate-500" : "text-slate-900"
              }`}
            >
              {formatDKK(inclMoms)}
            </span>
          </div>
        </div>

        {/* Quick amounts */}
        <div className="mt-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Hurtige beløb
          </p>
          <div className="flex flex-wrap gap-2">
            {[100, 500, 1000, 5000, 10000, 25000].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(v)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  amount === v
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:text-brand-600"
                }`}
              >
                {v.toLocaleString("da-DK")} kr
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Info box */}
      <div className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <p>
          Dansk moms er 25%. Virksomheder med en årlig omsætning over 50.000 kr.
          skal momsregistreres. Momsen opkræves hos kunden og afregnes
          kvartalsvis til Skattestyrelsen.
        </p>
      </div>
    </div>
  );
}
