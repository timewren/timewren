"use client";

import { ArrowRight, Check, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
} from "@/lib/billing/plan-gate";
import { appLinkHref, BUSINESS_MAX_SEATS } from "@/lib/config";
import {
  estimateTeamPrice,
  type TeamPrisOption,
} from "@/lib/marketing/team-pris";

const USER_PRESETS = [3, 5, 10, 20] as const;

// Samme Plausible-event som de øvrige signup-CTA'er.
const PLAUSIBLE_CTA_CLASS = "plausible-event-name=CTA+Click";

const TIER_POINTS: Record<TeamPrisOption["tier"], string[]> = {
  free: [
    `Op til ${FREE_MAX_SEATS} brugere og ${FREE_MAX_ACTIVE_CLIENTS} kunder`,
    "Med fakturering og klippekort",
  ],
  team: [
    "Fælles kunder, projekter og klippekort",
    "Se hvem der registrerede tid",
    "Teamrapporter og fakturagrundlag",
  ],
  business: [
    "Alt fra Team",
    "Ferie, fravær og flex-tid",
    "Check-in og godkendelser",
    "SSO",
  ],
};

const formatDKK = (n: number) =>
  n.toLocaleString("da-DK", {
    style: "currency",
    currency: "DKK",
    maximumFractionDigits: 0,
  });

/**
 * Team-prisberegner: hvad koster TimeTrack for X medarbejdere? Lead magnet
 * for team- og virksomhedssegmentet; tallene kommer fra samme prisfunktion
 * som onboarding og fakturering.
 */
export function TeamPrisBeregner({
  defaultNeedsHr = false,
  signupRef,
}: {
  /** Forvælg HR-behovet, fx på LP'en om lovpligtig registrering. */
  defaultNeedsHr?: boolean;
  /** Attribution på signup-links, fx "lp-medarbejdere". */
  signupRef?: string;
} = {}) {
  const [users, setUsers] = useState(8);
  const [needsHr, setNeedsHr] = useState(defaultNeedsHr);
  const refQuery = signupRef ? `ref=${encodeURIComponent(signupRef)}` : "";
  const [yearly, setYearly] = useState(false);

  const estimate = estimateTeamPrice(users, needsHr);
  const paidOptions = estimate.options.filter((o) => o.tier !== "free");
  const free = estimate.options.find((o) => o.tier === "free");

  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
        <h3 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Users className="h-5 w-5 text-brand-600" />
          Jeres team
        </h3>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <label
              htmlFor="tp-users"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Antal brugere: {estimate.users}
            </label>
            <input
              id="tp-users"
              type="range"
              value={Math.min(estimate.users, 60)}
              onChange={(e) => setUsers(Number(e.target.value))}
              min={1}
              max={60}
              step={1}
              className="w-full accent-brand-600"
            />
            <div className="mt-2 flex gap-2">
              {USER_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={estimate.users === preset}
                  onClick={() => setUsers(preset)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                    estimate.users === preset
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {preset}
                </button>
              ))}
              <input
                type="number"
                aria-label="Antal brugere (frit antal)"
                value={Number.isFinite(users) ? users : ""}
                onChange={(e) =>
                  setUsers(
                    e.target.value === "" ? Number.NaN : Number(e.target.value),
                  )
                }
                onBlur={() => setUsers(estimate.users)}
                min={1}
                max={500}
                className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>

          <div className="space-y-4">
            <fieldset>
              <legend className="mb-1 block text-sm font-medium text-slate-700">
                Betaling
              </legend>
              <div className="flex gap-2">
                {[
                  { value: false, label: "Månedlig" },
                  { value: true, label: "Årlig (2 mdr gratis)" },
                ].map((cycle) => (
                  <button
                    key={cycle.label}
                    type="button"
                    aria-pressed={yearly === cycle.value}
                    onClick={() => setYearly(cycle.value)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                      yearly === cycle.value
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {cycle.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={needsHr}
                onChange={(e) => setNeedsHr(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand-600"
              />
              Vi skal også styre ferie, fravær, flex-tid og godkendelser
            </label>
          </div>
        </div>
      </div>

      {estimate.users > BUSINESS_MAX_SEATS && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-slate-700">
          <p className="font-semibold text-slate-900">
            I er flere end {BUSINESS_MAX_SEATS} brugere
          </p>
          <p className="mt-1 text-sm">
            Så laver jeg en pris til jer. Skriv, hvor mange I er, og hvad I
            bruger i dag.
          </p>
          <Link
            href="/contact"
            className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            Kontakt os
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {paidOptions.map((o) => {
          const isRecommended = estimate.recommended === o.tier;
          const price = yearly ? o.yearlyTotal : o.monthlyTotal;
          return (
            <div
              key={o.tier}
              className={`rounded-2xl border p-6 ${
                !o.available
                  ? "border-slate-200 bg-slate-50 opacity-60"
                  : isRecommended
                    ? "border-brand-300 bg-brand-50/50 ring-2 ring-brand-600"
                    : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-lg font-bold text-slate-900">{o.name}</h4>
                {isRecommended && (
                  <span className="rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">
                    Passer til jer
                  </span>
                )}
              </div>

              {o.available ? (
                <div className="mt-4 space-y-3">
                  <dl>
                    <dt className="sr-only">Pris ekskl. moms</dt>
                    <dd className="text-3xl font-bold text-slate-900">
                      {formatDKK(price)}
                      <span className="text-base font-normal text-slate-500">
                        {yearly ? " /år" : " /md"}
                      </span>
                    </dd>
                    <dd className="text-sm text-slate-500">
                      ekskl. moms · {formatDKK(price * 1.25)} inkl. moms
                    </dd>
                  </dl>
                  <dl className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-3 text-sm">
                    <div>
                      <dt className="text-slate-600">Pr. bruger</dt>
                      <dd className="font-semibold text-slate-900">
                        {formatDKK(
                          yearly
                            ? Math.round(o.yearlyTotal / 12 / estimate.users)
                            : o.perUserMonthly,
                        )}{" "}
                        /md
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-600">
                        {yearly ? "Svarer til" : "Pladser"}
                      </dt>
                      <dd className="font-semibold text-slate-900">
                        {yearly
                          ? `${formatDKK(o.yearlyPerMonth)} /md`
                          : o.billedSeats}
                      </dd>
                    </div>
                  </dl>
                  {o.billedSeats > estimate.users && (
                    <p className="text-xs text-slate-500">
                      {o.name} starter ved {o.billedSeats} brugere, så prisen
                      dækker {o.billedSeats} pladser.
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-600">
                  {o.name} dækker ikke {estimate.users} brugere.
                </p>
              )}

              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                {TIER_POINTS[o.tier].map((point) => (
                  <li key={point} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                    {point}
                  </li>
                ))}
              </ul>

              {o.available && (
                <Link
                  href={appLinkHref(
                    `/register?plan=${o.tier}${refQuery ? `&${refQuery}` : ""}`,
                  )}
                  className={`${PLAUSIBLE_CTA_CLASS} mt-6 inline-flex w-full items-center justify-center gap-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                    isRecommended
                      ? "bg-brand-600 text-white hover:bg-brand-700"
                      : "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  Prøv {o.name} gratis i 30 dage
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {free?.available && (
        <p className="mt-6 text-center text-sm text-slate-600">
          Er I {estimate.users === 1 ? "kun én" : `${estimate.users}`}, kan I
          også starte på Gratis: {TIER_POINTS.free.join(", ").toLowerCase()}.{" "}
          <Link
            href={appLinkHref(`/register${refQuery ? `?${refQuery}` : ""}`)}
            className={`${PLAUSIBLE_CTA_CLASS} font-semibold text-brand-600`}
          >
            Start gratis
          </Link>
        </p>
      )}
    </div>
  );
}
