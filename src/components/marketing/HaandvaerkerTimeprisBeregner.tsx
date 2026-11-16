"use client";

import { Hammer, Receipt } from "lucide-react";
import { useState } from "react";
import { beregnHaandvaerkerTimepris } from "@/lib/marketing/loen";
import { parseDanskTal } from "@/lib/marketing/noegletal";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-4 py-2.5 pr-14 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";

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

export function HaandvaerkerTimeprisBeregner() {
  const [timeloen, setTimeloen] = useState("220");
  const [tillaeg, setTillaeg] = useState("25");
  const [betalteTimer, setBetalteTimer] = useState("1650");
  const [andel, setAndel] = useState("80");
  const [faste, setFaste] = useState("150000");
  const [avance, setAvance] = useState("15");

  const r = beregnHaandvaerkerTimepris({
    timeloen: parseDanskTal(timeloen),
    loentillaegPct: parseDanskTal(tillaeg),
    betalteTimerPrAar: parseDanskTal(betalteTimer),
    fakturerbarAndelPct: Math.min(100, parseDanskTal(andel)),
    fasteOmkostningerPrAar: parseDanskTal(faste),
    avancePct: parseDanskTal(avance),
  });

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Hammer className="h-5 w-5 text-brand-600" aria-hidden="true" />
          Hvad koster en time for dig?
        </h2>
        <div className="space-y-4">
          <Felt
            id="hv-loen"
            label="Timeløn til svenden"
            value={timeloen}
            onChange={setTimeloen}
            suffix="kr"
            hint="Eksempeltal. Brug jeres egen løn efter overenskomst eller aftale."
          />
          <Felt
            id="hv-tillaeg"
            label="Lønomkostninger oven i timelønnen"
            value={tillaeg}
            onChange={setTillaeg}
            suffix="%"
            hint="Pension, feriepenge (12,5 % for timelønnede), SH, forsikringer og ATP."
          />
          <Felt
            id="hv-timer"
            label="Betalte timer pr. år"
            value={betalteTimer}
            onChange={setBetalteTimer}
            suffix="t"
            hint="Arbejdstimer efter ferie og helligdage."
          />
          <Felt
            id="hv-andel"
            label="Andel der kan faktureres"
            value={andel}
            onChange={setAndel}
            suffix="%"
            hint="Kørsel, oprydning, tilbud og spildtid bliver ofte ikke faktureret."
          />
          <Felt
            id="hv-faste"
            label="Faste omkostninger pr. medarbejder pr. år"
            value={faste}
            onChange={setFaste}
            suffix="kr"
            hint="Varebil, værktøj, forsikring, kontor og administration."
          />
          <Felt
            id="hv-avance"
            label="Avance på kostprisen"
            value={avance}
            onChange={setAvance}
            suffix="%"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Receipt className="h-5 w-5 text-brand-600" aria-hidden="true" />
          Timepris til kunden
        </h2>
        {r === null ? (
          <p className="text-slate-600">
            Udfyld betalte timer og en fakturerbar andel over 0 %.
          </p>
        ) : (
          <div aria-live="polite">
            <div className="rounded-xl bg-brand-50 p-4">
              <p className="text-sm text-slate-600">Timepris ekskl. moms</p>
              <p className="text-3xl font-bold tabular-nums text-slate-900">
                {kr(r.timeprisEksMoms)}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Inkl. 25 % moms til privatkunder: {kr(r.timeprisInklMoms)}
              </p>
            </div>
            <dl className="mt-4 divide-y divide-slate-200 text-sm">
              <div className="flex justify-between py-2">
                <dt className="text-slate-600">
                  Lønomkostning pr. betalt time
                </dt>
                <dd className="tabular-nums text-slate-900">
                  {kr(r.loenomkostningPrTime)}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-600">Fakturerbare timer pr. år</dt>
                <dd className="tabular-nums text-slate-900">
                  {r.fakturerbareTimer.toLocaleString("da-DK", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  t
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-600">Løn pr. fakturerbar time</dt>
                <dd className="tabular-nums text-slate-900">
                  {kr(r.loenPrFakturerbarTime)}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-600">
                  Faste omkostninger pr. fakturerbar time
                </dt>
                <dd className="tabular-nums text-slate-900">
                  {kr(r.fastePrFakturerbarTime)}
                </dd>
              </div>
              <div className="flex justify-between py-2 font-semibold">
                <dt className="text-slate-900">
                  Kostpris pr. fakturerbar time
                </dt>
                <dd className="tabular-nums text-slate-900">
                  {kr(r.kostprisPrTime)}
                </dd>
              </div>
              <div className="flex justify-between py-2">
                <dt className="text-slate-600">Avance i % af timeprisen</dt>
                <dd className="tabular-nums text-slate-900">
                  {r.avanceAfTimepris === null ? "–" : pct(r.avanceAfTimepris)}
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-slate-500">
              Materialer, kørsel og eventuelle tillæg for overarbejde kommer
              oven i. Beregningen er vejledende og afhænger helt af de tal, du
              indtaster.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
