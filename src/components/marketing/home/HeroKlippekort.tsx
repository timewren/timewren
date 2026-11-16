"use client";

import { Bell, Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { klippekortModel } from "@/components/klippekort/huller-model";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/**
 * Forsidens klippekort (docs/BRAND.md → Klippekortet som motiv), bygget på
 * den rigtige huller-model, men med sin egen grid-rendering (ikke
 * KlippekortHuller), fordi det enkelte hul skal kunne pulsere ved stansning.
 * Ét klippekort pr. flade, og det er det eneste element med skygge.
 *
 * Live-eksemplet simulerer én arbejdsdag: en lille timer tæller op, et hul
 * stanses, saldoen falder, og en notifikation viser, hvad der sker i
 * appen. Rent decorativt, ét sekund-tick (ingen sub-sekund-animation), og
 * helt stille under prefers-reduced-motion (statisk startbillede, 7 af 20).
 */

const EKSEMPEL = {
  kunde: "Bageriet på hjørnet",
  kort: "Klippekort, 20 timer",
  total: 20,
  startTilbage: 7,
};

const SEKUNDER_PR_KLIP = 5;
const KLIP_PR_LOOP = 3;

const BESKEDER = [
  (tilbage: number) => `Kunden fik besked: ${tilbage} t tilbage`,
  () => "Fakturagrundlag klar til Billy",
];

const HOLE_PX = 18;
const GAP_PX = 6;
const PER_ROW = 10;

export function HeroKlippekort() {
  const reducedMotion = usePrefersReducedMotion();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [reducedMotion]);

  const cycle = Math.floor(tick / SEKUNDER_PR_KLIP);
  const sekunderIKlip = tick % SEKUNDER_PR_KLIP;
  const klipDenneLoop = cycle % KLIP_PR_LOOP;
  const tilbage = EKSEMPEL.startTilbage - klipDenneLoop;
  // klipDenneLoop (ikke cycle) afgør om der lige er stanset: ved hver ny
  // omgang af loopet (cycle et multiplum af KLIP_PR_LOOP) nulstiller
  // klipDenneLoop stille til 0 uden stansning, selv om cycle > 0.
  const ligeStanset = sekunderIKlip === 0 && klipDenneLoop > 0;
  const beskedSynlig = klipDenneLoop > 0 && sekunderIKlip < 3;
  const besked = beskedSynlig
    ? BESKEDER[(klipDenneLoop - 1) % BESKEDER.length](tilbage)
    : null;

  const model = klippekortModel(EKSEMPEL.total, tilbage);
  const sidstStansetHulIndex = model.holes.length - tilbage - 1;

  return (
    <div className="relative">
      <figure className="rounded-[14px] border border-tt-streg bg-tt-papir p-6 shadow-[0_18px_40px_-26px_rgba(26,29,28,0.45)] sm:p-7">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-tt-blaek">{EKSEMPEL.kunde}</span>
          <span className="flex items-center gap-1.5 text-sm text-tt-graa">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="tabular-nums">
              00:{String(sekunderIKlip).padStart(2, "0")}
            </span>
          </span>
        </div>

        <div
          role="img"
          aria-label={model.label}
          className="mt-5 grid w-fit"
          style={{
            gridTemplateColumns: `repeat(${Math.min(model.holes.length, PER_ROW)}, ${HOLE_PX}px)`,
            gap: `${GAP_PX}px`,
          }}
        >
          {model.holes.map((state, i) => (
            <span
              // Hullerne har ingen identitet ud over deres plads.
              // biome-ignore lint/suspicious/noArrayIndexKey: fast rækkefølge
              key={i}
              aria-hidden="true"
              className={`relative block overflow-hidden rounded-full border-[1.5px] border-tt-kant transition-transform duration-500 motion-reduce:transition-none ${
                ligeStanset && i === sidstStansetHulIndex
                  ? "scale-125"
                  : "scale-100"
              }`}
              style={{
                width: HOLE_PX,
                height: HOLE_PX,
                borderColor: state === "tom" ? undefined : "var(--tt-gran)",
              }}
            >
              {state !== "tom" && (
                <span
                  className="absolute inset-y-0 left-0 bg-tt-gran"
                  style={{ width: state === "halv" ? "50%" : "100%" }}
                />
              )}
            </span>
          ))}
        </div>

        <div className="mt-5 flex items-baseline justify-between gap-3 border-t border-dashed border-tt-streg pt-4">
          <span className="text-sm text-tt-graa">Tilbage</span>
          <span className="text-[40px] font-bold leading-none tracking-[-0.03em] text-tt-blaek">
            <span className="tabular-nums">{tilbage}</span> t
            <span className="ml-2 text-base font-medium tracking-normal text-tt-graa">
              af {EKSEMPEL.total}
            </span>
          </span>
        </div>

        <figcaption className="mt-3 text-[13px] text-tt-graa">
          Levende eksempel med appens rigtige klippekortmodel. Kunden og timerne
          er opdigtede.
        </figcaption>
      </figure>

      <div
        aria-hidden="true"
        className={`absolute -top-4 right-4 flex max-w-[230px] items-start gap-2 rounded-[10px] border border-tt-streg bg-tt-papir px-3 py-2.5 text-[13px] leading-snug text-tt-blaek shadow-[0_10px_24px_-14px_rgba(26,29,28,0.5)] transition-all duration-500 motion-reduce:hidden sm:max-w-[260px] ${
          besked
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tt-gran" />
        <span>{besked}</span>
      </div>
    </div>
  );
}
