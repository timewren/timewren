"use client";

import { ArrowRight, Check, Copy, RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePlausible } from "next-plausible";
import { useState } from "react";

/**
 * Freelance Health Check: 8 spørgsmål → score 0-100 + personlige
 * anbefalinger. Delbart resultat-link (?score=) — quizzer deles,
 * beregnere gør ikke (10x-planens marketing game).
 */

type Option = { label: string; points: number };
type Question = {
  id: string;
  question: string;
  options: Option[];
  /** Anbefaling der vises hvis dette spørgsmål scorer lavt. */
  advice: { text: string; href: string; linkLabel: string };
};

const QUESTIONS: Question[] = [
  {
    id: "registrering",
    question: "Hvornår registrerer du din arbejdstid?",
    options: [
      { label: "Mens jeg arbejder (timer/app)", points: 12 },
      { label: "Samme dag, bagefter", points: 8 },
      { label: "Sidst på ugen, efter hukommelsen", points: 3 },
      { label: "Jeg registrerer ikke systematisk", points: 0 },
    ],
    advice: {
      text: "Bagudrettet registrering runder altid ned. Det er dér timerne forsvinder.",
      href: "/ufaktureret-tid-beregner",
      linkLabel: "Se hvad det koster dig",
    },
  },
  {
    id: "overblik",
    question: "Ved du hvor mange timer du fakturerede sidste måned?",
    options: [
      { label: "Ja, præcist", points: 12 },
      { label: "Cirka", points: 8 },
      { label: "Nej", points: 2 },
    ],
    advice: {
      text: "Uden overblik pr. kunde og måned kan du hverken prissætte eller planlægge.",
      href: "/ugentlig-timerapport",
      linkLabel: "Prøv den ugentlige timerapport",
    },
  },
  {
    id: "fakturering",
    question:
      "Hvor lang tid går der typisk fra arbejdet er udført til fakturaen er sendt?",
    options: [
      { label: "Under en uge", points: 12 },
      { label: "Under en måned", points: 8 },
      { label: "Over en måned", points: 3 },
      { label: "Jeg glemmer nogle gange at fakturere", points: 0 },
    ],
    advice: {
      text: "Sen fakturering koster likviditet. Glemt fakturering koster alt.",
      href: "/timeregistrering-til-faktura",
      linkLabel: "Fra timer til faktura",
    },
  },
  {
    id: "timepris",
    question: "Har du hævet din timepris inden for det seneste år?",
    options: [
      { label: "Ja", points: 12 },
      { label: "Overvejet det, men ikke gjort det", points: 6 },
      { label: "Nej, den har stået stille i flere år", points: 2 },
    ],
    advice: {
      text: "En timepris der står stille, falder reelt hvert år med inflationen.",
      href: "/timepris-beregner",
      linkLabel: "Genberegn din timepris",
    },
  },
  {
    id: "forudbetaling",
    question: "Får du betaling forud (klippekort, depositum, aconto)?",
    options: [
      { label: "Ofte, det er min standardmodel", points: 12 },
      { label: "Nogle gange", points: 8 },
      { label: "Aldrig, jeg fakturerer altid bagud", points: 2 },
    ],
    advice: {
      text: "Forudbetalte timepakker giver likviditet og fjerner debitor-risikoen.",
      href: "/klippekort-prisberegner",
      linkLabel: "Prissæt dit første klippekort",
    },
  },
  {
    id: "rykkere",
    question: "Hvor ofte må du rykke kunder for betaling?",
    options: [
      { label: "Sjældent, de betaler til tiden", points: 12 },
      { label: "Af og til", points: 8 },
      { label: "Ofte, og det er akavet hver gang", points: 3 },
    ],
    advice: {
      text: "Hyppige rykkere er et symptom: uklare aftaler eller forkert betalingsmodel.",
      href: "/blog/fakturering-fejl-freelancer",
      linkLabel: "De typiske faktureringsfejl",
    },
  },
  {
    id: "aftaler",
    question: "Har du skriftlig aftale på dine opgaver?",
    options: [
      { label: "Altid", points: 12 },
      { label: "Som regel", points: 8 },
      { label: "Sjældent, vi aftaler det mundtligt", points: 2 },
    ],
    advice: {
      text: "Uden skriftlig aftale er enhver uenighed om scope din regning.",
      href: "/blog/fakturering-fejl-freelancer",
      linkLabel: "Undgå de klassiske fejl",
    },
  },
  {
    id: "effektiv",
    question:
      "Kender du din reelle, effektive timepris (inkl. al ufakturerbar tid)?",
    options: [
      { label: "Ja, jeg følger den løbende", points: 16 },
      { label: "Nogenlunde", points: 8 },
      { label: "Nej", points: 0 },
    ],
    advice: {
      text: "Din effektive timepris er det tal der afgør om forretningen hænger sammen.",
      href: "/timepris-beregner",
      linkLabel: "Regn den ud nu",
    },
  },
];

const MAX_SCORE = QUESTIONS.reduce(
  (sum, q) => sum + Math.max(...q.options.map((o) => o.points)),
  0,
);

function scoreLevel(score: number): { title: string; description: string } {
  if (score >= 80)
    return {
      title: "Professionel drift",
      description:
        "Din freelance-forretning kører stramt. Finpuds detaljerne, og overvej om din tid kan bruges endnu bedre.",
    };
  if (score >= 55)
    return {
      title: "Solidt, men du efterlader penge på bordet",
      description:
        "Fundamentet er der, men et par utætheder koster dig reelle kroner hver måned.",
    };
  if (score >= 30)
    return {
      title: "Utæt forretning",
      description:
        "Du arbejder hårdt, men for meget af værdien når aldrig frem til fakturaen.",
    };
  return {
    title: "Alarm: du arbejder gratis for ofte",
    description:
      "Der er hurtige gevinster at hente: start med tidsregistreringen, resten følger.",
  };
}

export function FreelanceHealthCheck({
  sharedScore,
}: {
  /** Score fra et delt resultat-link (?score=NN) — viser social-banner. */
  sharedScore?: number;
}) {
  const plausible = usePlausible();
  // Gemmer valgt options-INDEKS pr. spørgsmål (ikke point) — robust selv
  // hvis to svarmuligheder skulle give samme point.
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);

  const answeredCount = Object.keys(answers).length;
  const pointsFor = (q: Question) =>
    answers[q.id] !== undefined ? q.options[answers[q.id]].points : 0;
  const score = Math.round(
    (QUESTIONS.reduce((sum, q) => sum + pointsFor(q), 0) / MAX_SCORE) * 100,
  );

  const submit = () => {
    setSubmitted(true);
    const bucket =
      score >= 80
        ? "80+"
        : score >= 55
          ? "55-79"
          : score >= 30
            ? "30-54"
            : "0-29";
    plausible("quiz_completed", {
      props: { quiz: "freelance-health-check", bucket },
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const copyShareLink = async () => {
    const url = `${window.location.origin}/freelance-health-check?score=${score}`;
    await navigator.clipboard.writeText(
      `Jeg scorede ${score}/100 i Freelance Health Check. Hvad scorer du? ${url}`,
    );
    setCopied(true);
    plausible("quiz_shared", { props: { quiz: "freelance-health-check" } });
    setTimeout(() => setCopied(false), 2500);
  };

  if (submitted) {
    const level = scoreLevel(score);
    // De 3 lavest-scorende spørgsmål (relativt til max) driver anbefalingerne.
    const weakest = QUESTIONS.map((q) => ({
      q,
      ratio: pointsFor(q) / Math.max(...q.options.map((o) => o.points)),
    }))
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, 3)
      .filter((w) => w.ratio < 1);

    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-brand-700">
            Din score
          </p>
          <p className="mt-2 text-6xl font-bold text-brand-700">{score}</p>
          <p className="text-sm text-slate-500">af 100</p>
          <h3 className="mt-4 text-2xl font-bold text-slate-900">
            {level.title}
          </h3>
          <p className="mt-2 text-slate-600">{level.description}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={copyShareLink}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-900 transition-colors hover:bg-slate-50"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "Kopieret!" : "Kopiér resultat-link"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAnswers({});
                setSubmitted(false);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-900 transition-colors hover:bg-slate-50"
            >
              <RotateCcw className="h-4 w-4" />
              Tag testen igen
            </button>
          </div>
        </div>

        {weakest.length > 0 && (
          <div className="mt-8">
            <h4 className="text-lg font-semibold text-slate-900">
              Dine hurtigste gevinster
            </h4>
            <ul className="mt-4 space-y-4">
              {weakest.map(({ q }) => (
                <li
                  key={q.id}
                  className="rounded-xl border border-slate-200/60 bg-white p-5 shadow-sm"
                >
                  <p className="text-slate-700">{q.advice.text}</p>
                  <Link
                    href={q.advice.href}
                    className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
                  >
                    {q.advice.linkLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {typeof sharedScore === "number" && (
        <div className="mb-8 rounded-xl border border-brand-200 bg-brand-50 p-4 text-center text-slate-800">
          En freelancer scorede <strong>{sharedScore}/100</strong>. Hvad scorer
          du?
        </div>
      )}
      <ol className="space-y-8">
        {QUESTIONS.map((q, qi) => (
          <li key={q.id}>
            <p className="font-semibold text-slate-900">
              {qi + 1}. {q.question}
            </p>
            <div className="mt-3 space-y-2">
              {q.options.map((opt, oi) => (
                <label
                  key={opt.label}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors hover:bg-slate-50 ${
                    answers[q.id] === oi
                      ? "border-brand-400 bg-brand-50/50"
                      : "border-slate-200"
                  }`}
                >
                  <input
                    type="radio"
                    name={q.id}
                    checked={answers[q.id] === oi}
                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: oi }))}
                    className="accent-brand-600"
                  />
                  <span className="text-slate-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-10 text-center">
        <button
          type="button"
          disabled={answeredCount < QUESTIONS.length}
          onClick={submit}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white transition-all hover:bg-brand-700 hover:shadow-lg disabled:opacity-50"
        >
          Se min score
          <ArrowRight className="h-5 w-5" />
        </button>
        {answeredCount < QUESTIONS.length && (
          <p className="mt-2 text-sm text-slate-500">
            {answeredCount} af {QUESTIONS.length} besvaret
          </p>
        )}
      </div>
    </div>
  );
}
