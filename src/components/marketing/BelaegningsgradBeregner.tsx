"use client";

import { Gauge, Target } from "lucide-react";
import { useState } from "react";
import {
  belaegningForOmsaetning,
  beregnBelaegning,
  parseDanskTal,
} from "@/lib/marketing/noegletal";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-4 py-2.5 pr-16 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

const parseTal = parseDanskTal;

const kr = (n: number) =>
  `${n.toLocaleString("da-DK", { maximumFractionDigits: 0 })} kr`;
const tal = (n: number) =>
  n.toLocaleString("da-DK", { maximumFractionDigits: 0 });
const pct = (n: number) =>
  `${n.toLocaleString("da-DK", { maximumFractionDigits: 1 })} %`;

function Felt({
  id,
  label,
  value,
  onChange,
  suffix,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix: string;
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-sm font-medium text-slate-700"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-400">
          {suffix}
        </span>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function BelaegningsgradBeregner() {
  const [normtid, setNormtid] = useState("37");
  const [fravaer, setFravaer] = useState("7");
  const [fakturerbare, setFakturerbare] = useState("24");
  const [timepris, setTimepris] = useState("850");
  const [maal, setMaal] = useState("1100000");

  const r = beregnBelaegning({
    normtidPrUge: parseTal(normtid),
    fravaersuger: parseTal(fravaer),
    fakturerbareTimerPrUge: parseTal(fakturerbare),
    timepris: parseTal(timepris),
  });
  const kraevet = belaegningForOmsaetning({
    maalOmsaetning: parseTal(maal),
    disponibleTimer: r.disponibleTimer,
    timepris: parseTal(timepris),
  });

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Gauge className="h-5 w-5 text-brand-600" aria-hidden="true" />
          Din belægningsgrad
        </h2>
        <div className="space-y-4">
          <Felt
            id="bg-norm"
            label="Normtid pr. uge"
            value={normtid}
            onChange={setNormtid}
            suffix="timer"
          />
          <Felt
            id="bg-fravaer"
            label="Uger uden arbejde pr. år"
            value={fravaer}
            onChange={setFravaer}
            suffix="uger"
            hint="Ferie (5 uger), helligdage (ca. 1,5 uge) og lidt sygdom giver typisk 7."
          />
          <Felt
            id="bg-fakt"
            label="Fakturerbare timer pr. uge i snit"
            value={fakturerbare}
            onChange={setFakturerbare}
            suffix="timer"
            hint="Kun de timer, en kunde betaler for. Ikke salg, admin og interne møder."
          />
          <Felt
            id="bg-pris"
            label="Gennemsnitlig timepris ekskl. moms"
            value={timepris}
            onChange={setTimepris}
            suffix="kr"
          />
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-3" aria-live="polite">
          <div className="rounded-xl bg-brand-50 p-4">
            <dt className="text-sm text-slate-600">Belægningsgrad</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">
              {r.belaegningsgrad === null ? "–" : pct(r.belaegningsgrad)}
            </dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="text-sm text-slate-600">Omsætning pr. år</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">
              {kr(r.omsaetning)}
            </dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="text-sm text-slate-600">
              Fakturerbare timer pr. år
            </dt>
            <dd className="text-xl font-semibold tabular-nums text-slate-900">
              {tal(r.fakturerbareTimer)} af {tal(r.disponibleTimer)}
            </dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="text-sm text-slate-600">
              1 procentpoint mere er værd
            </dt>
            <dd className="text-xl font-semibold tabular-nums text-slate-900">
              {kr(r.vaerdiPrProcentpoint)} om året
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Target className="h-5 w-5 text-brand-600" aria-hidden="true" />
          Hvilken belægning kræver dit mål?
        </h2>
        <Felt
          id="bg-maal"
          label="Ønsket omsætning pr. år ekskl. moms"
          value={maal}
          onChange={setMaal}
          suffix="kr"
        />
        <div className="mt-6 rounded-xl bg-brand-50 p-4" aria-live="polite">
          <p className="text-sm text-slate-600">Krævet belægningsgrad</p>
          <p className="text-3xl font-bold tabular-nums text-slate-900">
            {kraevet === null ? "–" : pct(kraevet)}
          </p>
          {kraevet !== null && (
            <p className="mt-2 text-sm text-slate-600">
              {kraevet > 85
                ? "Over 85 % holder sjældent et helt år, når salg, admin og efteruddannelse også skal passes. Overvej en højere timepris i stedet."
                : `Svarer til ${tal((kraevet / 100) * parseTal(normtid))} fakturerbare timer i en normal uge.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
