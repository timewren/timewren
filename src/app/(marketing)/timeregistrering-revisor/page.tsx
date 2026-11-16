import { CalendarClock, FileWarning, Repeat } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

const TITLE = "Timeregistrering for revisorer og bogholdere";
const DESCRIPTION =
  "Timeregistrering til revisorer og freelance bogholdere: se om fastprisaftalerne holder, få ekstraarbejdet faktureret og send fakturaen til Billy eller Dinero. Gratis at starte.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "timeregistrering revisor",
    "tidsregistrering revisor",
    "timeregistrering bogholder",
    "hvad koster en revisor i timen",
    "timepris bogholder",
  ],
  alternates: { canonical: "/timeregistrering-revisor" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/timeregistrering-revisor",
    type: "website",
  },
};

const FAQ = [
  {
    question: "Hvad koster en revisor i timen?",
    answer:
      "Danske prisguider angiver typisk 400-800 kr. ekskl. moms for en bogholder, cirka 800-1.500 kr. for en registreret revisor og op til omkring 2.500 kr. for en statsautoriseret revisor (set 1. oktober 2026). Mange små kunder betaler i stedet en fast månedspris for bogføring og moms.",
  },
  {
    question: "Hvorfor registrere tid, når kunden betaler fast pris?",
    answer:
      "Fordi det er den eneste måde at se, om den faste pris holder. Når tre kunder betaler det samme, men den ene bruger tre gange så meget tid, er det din effektive timepris, der betaler. Med tiden registreret har du tallene, når prisen skal genforhandles.",
  },
  {
    question: "Hvordan fakturerer jeg ekstraarbejde ud over abonnementet?",
    answer:
      "Opret ekstraarbejdet som et separat projekt med timepris, fx “Ekstra: oprydning i bilag 2026”. Så holdes det ude af abonnementet, og det lander som sin egen linje på fakturagrundlaget, når du sender til Billy eller Dinero.",
  },
  {
    question: "Kan jeg bruge TimeTrack sammen med mit regnskabsprogram?",
    answer:
      "Ja. TimeTrack registrerer tiden og laver fakturagrundlaget. Selve fakturaen sendes til Billy eller Dinero, så den ligger i det regnskab, du allerede bruger. Bruger du e-conomic, kan du forbinde det som integration eller eksportere fakturagrundlaget som CSV. Kunder kan hentes med CVR-opslag.",
  },
  {
    question: "Er TimeTrack et revisionssystem?",
    answer:
      "Nej. Der er ingen revisionsdokumentation, checklister eller erklæringsskabeloner. TimeTrack er til tid, timepriser, klippekort og fakturering, og passer bedst til freelance bogholdere og mindre revisor- og regnskabskontorer.",
  },
];

const PAINS = [
  {
    icon: Repeat,
    title: "Fastprisaftaler uden efterkalkulation",
    text: "Bogføring til 2.500 kr. om måneden lyder fint, indtil kunden med en skoæske fuld af bilag bruger ni timer. Uden tid pr. kunde opdager du det først ved årsafslutningen, hvis overhovedet.",
  },
  {
    icon: FileWarning,
    title: "Ekstraarbejde, der glider ind i abonnementet",
    text: "En ekstra afstemning, et spørgsmål om moms på en ny ydelse, en rykker til SKAT. Det er ekstraarbejde, men det ender ofte gratis, fordi det ikke blev skrevet ned med det samme.",
  },
  {
    icon: CalendarClock,
    title: "Sæsonpres op til fristerne",
    text: "Op til momsfristerne og i årsregnskabssæsonen springer man mellem mange kunder på en dag. Bliver tiden skrevet bagud fredag eftermiddag, er den gættet.",
  },
];

const KUNDER = [
  { navn: "Kunde A (webshop)", timer: 3, pris: 2500 },
  { navn: "Kunde B (konsulent)", timer: 4.5, pris: 2500 },
  { navn: "Kunde C (håndværker)", timer: 9, pris: 2500 },
];

export default function TimeregistreringRevisorPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <SEOPageLayout
      badge="Til revisorer og bogholdere"
      title="Timeregistrering for revisorer og bogholdere"
      subtitle="Se hvilke fastprisaftaler der holder, få ekstraarbejdet med på fakturaen, og send den til Billy eller Dinero uden at taste timerne igen."
      jsonLd={faqSchema}
      faqItems={FAQ.map((f) => ({
        question: f.question,
        answer: <p>{f.answer}</p>,
      }))}
      relatedLinks={[
        {
          href: "/klippekort",
          title: "Klippekort",
          description: "Forudbetalte timer til ad hoc-rådgivning.",
        },
        {
          href: "/daekningsgrad-beregner",
          title: "Dækningsgrad-beregner",
          description: "Dækningsbidrag og nulpunkt, forklaret med eksempler.",
        },
        {
          href: "/timeregistrering-advokat",
          title: "Timeregistrering for advokater",
          description: "Salær, sager og specificeret fakturagrundlag.",
        },
      ]}
      ctaTitle="Kend den reelle timepris på hver kunde"
      ctaSubtitle={`Gratis for op til 3 brugere og 3 kunder. Selvstændig ${PLAN_PRICES.selvstaendig.price}, Team ${PLAN_PRICES.team.price}, begge ekskl. moms.`}
    >
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Her taber regnskabsfolk timerne
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {PAINS.map((p) => (
              <div
                key={p.title}
                className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm"
              >
                <p.icon
                  className="mb-4 h-8 w-8 text-brand-600"
                  aria-hidden="true"
                />
                <h3 className="mb-2 text-xl font-semibold text-slate-900">
                  {p.title}
                </h3>
                <p className="text-slate-600">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Eksempel: tre kunder til samme faste pris
          </h2>
          <p>
            Tre kunder betaler hver 2.500 kr. ekskl. moms om måneden for løbende
            bogføring og momsindberetning. Sådan ser den samme pris ud, når
            tiden er registreret:
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Kunde
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Timer pr. md
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Effektiv timepris
                  </th>
                </tr>
              </thead>
              <tbody>
                {KUNDER.map((k) => (
                  <tr key={k.navn} className="border-t border-slate-200">
                    <td className="px-4 py-2">{k.navn}</td>
                    <td className="px-4 py-2 text-right">
                      {k.timer.toLocaleString("da-DK")}
                    </td>
                    <td className="px-4 py-2 text-right font-medium">
                      {Math.round(k.pris / k.timer).toLocaleString("da-DK")} kr.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Kunde C giver kun en tredjedel af kunde A’s timepris. Løsningen er
            sjældent at opsige kunden, men at have tallene klar, når prisen skal
            justeres, eller at aftale at rodede bilag faktureres som
            ekstraarbejde.
          </p>
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Sådan sætter du det op i TimeTrack
          </h2>
          <ol className="list-decimal space-y-3 pl-6">
            <li>
              <strong>Hver kunde oprettes med CVR-opslag</strong>, så stamdata
              passer til fakturaen.
            </li>
            <li>
              <strong>Ét projekt pr. ydelse</strong>: “Løbende bogføring”,
              “Årsregnskab 2026”, “Lønadministration”. Bogføringen får en fast
              pris og et månedligt timebudget, der nulstilles hver måned, så du
              kan se, når en kunde begynder at løbe over.
            </li>
            <li>
              <strong>Ekstraarbejde får sit eget projekt med timepris.</strong>{" "}
              Det holder abonnementet rent og ekstraarbejdet synligt.
            </li>
            <li>
              <strong>
                Ad hoc-rådgivning sælges som{" "}
                <Link href="/klippekort" className="text-brand-600 underline">
                  klippekort
                </Link>
              </strong>
              , fx 10 timer. Kunden betaler på forhånd, og timerne trækkes, når
              du registrerer.
            </li>
            <li>
              <strong>Rapporten “Hvad tjener du faktisk?”</strong> viser den
              reelle timepris pr. kunde, altså optjente kroner delt med alle
              brugte timer.
            </li>
          </ol>
          <p>
            Fakturaen sendes til{" "}
            <Link href="/billy" className="text-brand-600 underline">
              Billy
            </Link>{" "}
            eller{" "}
            <Link href="/dinero" className="text-brand-600 underline">
              Dinero
            </Link>
            . Til{" "}
            <Link href="/e-conomic" className="text-brand-600 underline">
              e-conomic
            </Link>{" "}
            er der integration og fakturagrundlag. Er I flere på kontoret, kan
            hver medarbejder have sin egen timepris i Team (49 kr. pr. bruger om
            måneden), og Gratis dækker op til 3 brugere og 3 kunder, så du kan
            prøve med rigtige data først.
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
