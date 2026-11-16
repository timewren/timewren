"use client";

import { ArrowRightLeft, Clock, Receipt } from "lucide-react";
import { useState } from "react";
import { parseDanskTal } from "@/lib/marketing/noegletal";
import {
  decimalTilTimerOgMinutter,
  forkertKommaTimer,
  formatDecimaltimer,
  minutterTilDecimal,
} from "@/lib/marketing/tidsomregning";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

const parseTal = parseDanskTal;

/**
 * Omregner minutter og timer:minutter til decimaltimer (100-dele) og tilbage.
 * Ren klientberegning — ingen data forlader browseren.
 */
export function MinutterTilTimerBeregner() {
  const [timer, setTimer] = useState("1");
  const [minutter, setMinutter] = useState("45");
  const [decimal, setDecimal] = useState("2,3");
  const [timepris, setTimepris] = useState("750");

  const totalMinutter = parseTal(timer) * 60 + parseTal(minutter);
  const decimalTimer = minutterTilDecimal(totalMinutter);
  const tilbage = decimalTilTimerOgMinutter(parseTal(decimal));
  const beloeb = decimalTimer * parseTal(timepris);
  const forkert = forkertKommaTimer(totalMinutter);
  const fejlTab = (decimalTimer - forkert) * parseTal(timepris);

  return (
    <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Clock className="h-5 w-5 text-brand-600" aria-hidden="true" />
          Timer og minutter → decimaltimer
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="mt-timer"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Timer
            </label>
            <input
              id="mt-timer"
              inputMode="decimal"
              value={timer}
              onChange={(e) => setTimer(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label
              htmlFor="mt-minutter"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Minutter
            </label>
            <input
              id="mt-minutter"
              inputMode="decimal"
              value={minutter}
              onChange={(e) => setMinutter(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Du kan også skrive alle minutterne i feltet til højre, fx 0 timer og
          135 minutter.
        </p>
        <div className="mt-5 rounded-xl bg-brand-50 p-4" aria-live="polite">
          <p className="text-sm text-slate-600">Svarer til</p>
          <p className="text-3xl font-bold tabular-nums text-slate-900">
            {formatDecimaltimer(decimalTimer)} timer
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {totalMinutter.toLocaleString("da-DK")} minutter ÷ 60
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <ArrowRightLeft
            className="h-5 w-5 text-brand-600"
            aria-hidden="true"
          />
          Decimaltimer → timer og minutter
        </h2>
        <label
          htmlFor="mt-decimal"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Decimaltimer (fx 2,3)
        </label>
        <input
          id="mt-decimal"
          inputMode="decimal"
          value={decimal}
          onChange={(e) => setDecimal(e.target.value)}
          className={inputClass}
        />
        <div className="mt-5 rounded-xl bg-slate-50 p-4" aria-live="polite">
          <p className="text-sm text-slate-600">Svarer til</p>
          <p className="text-3xl font-bold tabular-nums text-slate-900">
            {tilbage.timer} t {tilbage.minutter} min
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Decimaldelen × 60 = minutterne
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm md:col-span-2">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Receipt className="h-5 w-5 text-brand-600" aria-hidden="true" />
          Hvad bliver det på fakturaen?
        </h2>
        <div className="grid items-end gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="mt-timepris"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Timepris ekskl. moms (kr)
            </label>
            <input
              id="mt-timepris"
              inputMode="decimal"
              value={timepris}
              onChange={(e) => setTimepris(e.target.value)}
              className={inputClass}
            />
          </div>
          <p className="text-slate-700" aria-live="polite">
            {formatDecimaltimer(decimalTimer)} timer ×{" "}
            {parseTal(timepris).toLocaleString("da-DK")} kr ={" "}
            <strong className="text-slate-900">
              {beloeb.toLocaleString("da-DK", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              kr
            </strong>
          </p>
        </div>
        {fejlTab > 0 && (
          <p className="mt-3 text-sm text-slate-500">
            Skriver du {forkert.toLocaleString("da-DK")} på fakturaen (timer og
            minutter med komma) i stedet for {formatDecimaltimer(decimalTimer)},
            mister du{" "}
            {fejlTab.toLocaleString("da-DK", { maximumFractionDigits: 0 })} kr.
            Det er den klassiske fejl.
          </p>
        )}
      </div>
    </div>
  );
}
