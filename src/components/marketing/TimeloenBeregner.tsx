"use client";

import { ArrowLeftRight, Clock } from "lucide-react";
import { useState } from "react";
import {
  maanedsloenTilTimeloen,
  timeloenTilMaanedsloen,
  timerPrMaaned,
} from "@/lib/marketing/loen";
import { parseDanskTal } from "@/lib/marketing/noegletal";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-4 py-2.5 pr-14 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

const kr = (n: number, decimaler = 0) =>
  `${n.toLocaleString("da-DK", {
    minimumFractionDigits: decimaler,
    maximumFractionDigits: decimaler,
  })} kr`;

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

export function TimeloenBeregner() {
  const [maanedsloen, setMaanedsloen] = useState("35000");
  const [timerA, setTimerA] = useState("37");
  const [timeloen, setTimeloen] = useState("200");
  const [timerB, setTimerB] = useState("37");

  const timerPrMdA = timerPrMaaned(parseDanskTal(timerA));
  const tilTimeloen = maanedsloenTilTimeloen(
    parseDanskTal(maanedsloen),
    parseDanskTal(timerA),
  );
  const timerPrMdB = timerPrMaaned(parseDanskTal(timerB));
  const tilMaanedsloen = timeloenTilMaanedsloen(
    parseDanskTal(timeloen),
    parseDanskTal(timerB),
  );
  const timer = (n: number) =>
    n.toLocaleString("da-DK", { maximumFractionDigits: 2 });

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Clock className="h-5 w-5 text-brand-600" aria-hidden="true" />
          Månedsløn til timeløn
        </h2>
        <div className="space-y-4">
          <Felt
            id="tl-maaned"
            label="Månedsløn før skat"
            value={maanedsloen}
            onChange={setMaanedsloen}
            suffix="kr"
          />
          <Felt
            id="tl-timer-a"
            label="Arbejdstid pr. uge"
            value={timerA}
            onChange={setTimerA}
            suffix="t"
            hint="37 timer er fuld tid på de fleste overenskomster."
          />
        </div>
        <div className="mt-6 rounded-xl bg-brand-50 p-4" aria-live="polite">
          <p className="text-sm text-slate-600">Timeløn</p>
          <p className="text-3xl font-bold tabular-nums text-slate-900">
            {tilTimeloen === null ? "–" : kr(tilTimeloen, 2)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Månedslønnen delt med {timer(timerPrMdA)} timer pr. måned.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <ArrowLeftRight
            className="h-5 w-5 text-brand-600"
            aria-hidden="true"
          />
          Timeløn til månedsløn
        </h2>
        <div className="space-y-4">
          <Felt
            id="tl-time"
            label="Timeløn før skat"
            value={timeloen}
            onChange={setTimeloen}
            suffix="kr"
          />
          <Felt
            id="tl-timer-b"
            label="Arbejdstid pr. uge"
            value={timerB}
            onChange={setTimerB}
            suffix="t"
          />
        </div>
        <div className="mt-6 rounded-xl bg-brand-50 p-4" aria-live="polite">
          <p className="text-sm text-slate-600">Månedsløn</p>
          <p className="text-3xl font-bold tabular-nums text-slate-900">
            {kr(tilMaanedsloen)}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            {timer(timerPrMdB)} timer pr. måned. Årsløn:{" "}
            {kr(tilMaanedsloen * 12)}.
          </p>
        </div>
      </div>
    </div>
  );
}
