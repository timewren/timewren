"use client";

import { Percent, Tag } from "lucide-react";
import { useState } from "react";
import {
  beregnDaekning,
  parseDanskTal,
  prisForDaekningsgrad,
} from "@/lib/marketing/noegletal";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-4 py-2.5 pr-14 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

const parseTal = parseDanskTal;

const kr = (n: number) =>
  `${n.toLocaleString("da-DK", { maximumFractionDigits: 0 })} kr`;
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

export function DaekningsgradBeregner() {
  const [omsaetning, setOmsaetning] = useState("800000");
  const [variable, setVariable] = useState("320000");
  const [faste, setFaste] = useState("180000");
  const [kostpris, setKostpris] = useState("450");
  const [oensketDg, setOensketDg] = useState("40");

  const r = beregnDaekning({
    omsaetning: parseTal(omsaetning),
    variableOmkostninger: parseTal(variable),
    fasteOmkostninger: parseTal(faste),
  });
  const pris = prisForDaekningsgrad(parseTal(kostpris), parseTal(oensketDg));

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Percent className="h-5 w-5 text-brand-600" aria-hidden="true" />
          Dækningsbidrag og dækningsgrad
        </h2>
        <div className="space-y-4">
          <Felt
            id="dg-oms"
            label="Omsætning ekskl. moms"
            value={omsaetning}
            onChange={setOmsaetning}
            suffix="kr"
          />
          <Felt
            id="dg-var"
            label="Variable omkostninger"
            value={variable}
            onChange={setVariable}
            suffix="kr"
            hint="Det der stiger med salget: vareforbrug, underleverandører, timeløn til opgaven."
          />
          <Felt
            id="dg-faste"
            label="Faste omkostninger (valgfri)"
            value={faste}
            onChange={setFaste}
            suffix="kr"
            hint="Husleje, software, forsikring og egen løn. Bruges til resultat og nulpunkt."
          />
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-3" aria-live="polite">
          <div className="rounded-xl bg-brand-50 p-4">
            <dt className="text-sm text-slate-600">Dækningsgrad</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">
              {r.daekningsgrad === null ? "–" : pct(r.daekningsgrad)}
            </dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="text-sm text-slate-600">Dækningsbidrag</dt>
            <dd className="text-2xl font-bold tabular-nums text-slate-900">
              {kr(r.daekningsbidrag)}
            </dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="text-sm text-slate-600">Resultat</dt>
            <dd
              className={`text-xl font-semibold tabular-nums ${r.resultat < 0 ? "text-red-700" : "text-slate-900"}`}
            >
              {kr(r.resultat)}
            </dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="text-sm text-slate-600">Nulpunktsomsætning</dt>
            <dd className="text-xl font-semibold tabular-nums text-slate-900">
              {r.nulpunktsomsaetning === null ? "–" : kr(r.nulpunktsomsaetning)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Tag className="h-5 w-5 text-brand-600" aria-hidden="true" />
          Hvilken pris giver den dækningsgrad, du vil have?
        </h2>
        <div className="space-y-4">
          <Felt
            id="dg-kost"
            label="Kostpris pr. enhed eller time"
            value={kostpris}
            onChange={setKostpris}
            suffix="kr"
            hint="Fx hvad en medarbejder eller underleverandør koster dig pr. time."
          />
          <Felt
            id="dg-oensket"
            label="Ønsket dækningsgrad"
            value={oensketDg}
            onChange={setOensketDg}
            suffix="%"
          />
        </div>
        <div className="mt-6 rounded-xl bg-brand-50 p-4" aria-live="polite">
          <p className="text-sm text-slate-600">Salgspris ekskl. moms</p>
          <p className="text-3xl font-bold tabular-nums text-slate-900">
            {pris === null ? "–" : kr(pris)}
          </p>
          {pris !== null && (
            <p className="mt-1 text-sm text-slate-600">
              Kostpris ÷ (1 − dækningsgrad). Et pålæg på samme procent giver
              mindre: {kr(parseTal(kostpris) * (1 + parseTal(oensketDg) / 100))}
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
