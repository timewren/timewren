import type { Metadata } from "next";
import Link from "next/link";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
} from "@/lib/billing/plan-limits";
import {
  BUSINESS_SEAT_PRICE_MONTHLY,
  PRIVAT_PRICE_MONTHLY,
  SUBSCRIPTION_PRICE_MONTHLY,
  TEAM_SEAT_PRICE_MONTHLY,
} from "@/lib/config";

const TITLE = "Gratis tidsregistrering: uden tidsbegrænsning";
const DESCRIPTION = `Gratis tidsregistrering til web, telefon og browser: op til ${FREE_MAX_SEATS} brugere, ${FREE_MAX_ACTIVE_CLIENTS} kunder og ubegrænsede timer. Intet betalingskort og ingen udløbsdato.`;

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | TimeTrack` },
  description: DESCRIPTION,
  alternates: { canonical: "/gratis-tidsregistrering" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/gratis-tidsregistrering",
    type: "website",
  },
};

const INCLUDED = [
  "Timer med start og stop, og tid skrevet ind bagefter",
  "Ubegrænsede projekter og registreringer",
  `Op til ${FREE_MAX_ACTIVE_CLIENTS} aktive kunder`,
  "Rapporter pr. dag, uge og måned",
  "Web, telefon, browserudvidelse og desktop",
  "Database og backup i EU, og du kan altid hente dine data ud",
];

const UPGRADES = [
  {
    plan: "Privat",
    price: `${PRIVAT_PRICE_MONTHLY} kr./md.`,
    when: "Når du har flere end 3 kunder eller projekter at holde adskilt.",
  },
  {
    plan: "Selvstændig",
    price: `${SUBSCRIPTION_PRICE_MONTHLY} kr./md.`,
    when: "Når timerne skal blive til fakturaer eller klippekort.",
  },
  {
    plan: "Team",
    price: `${TEAM_SEAT_PRICE_MONTHLY} kr. pr. bruger/md.`,
    when: "Når I er flere, der deler kunder og projekter.",
  },
  {
    plan: "Virksomhed",
    price: `${BUSINESS_SEAT_PRICE_MONTHLY} kr. pr. bruger/md.`,
    when: "Når ansattes arbejdstid, ferie og fravær skal registreres.",
  },
];

// Gratis vs. fakturerende tidsregistrering (#699). Ligger her i stedet for på
// en ny side, så "gratis tidsregistrering" kun har én side at ranke med.
const FREE_VS_INVOICING = [
  { step: "Registrér tid med timer eller manuelt", free: true, paid: true },
  { step: "Faktura ud fra de registrerede timer", free: false, paid: true },
  { step: "Klippekort, der trækkes automatisk", free: false, paid: true },
  {
    step: "Fakturaen bogføres i Billy eller Dinero",
    free: false,
    paid: true,
  },
];

const FAQ = [
  {
    question: "Er det virkelig gratis?",
    answer: `Ja. Gratis har ingen udløbsdato og kræver intet betalingskort. Du kan bruge den med op til ${FREE_MAX_SEATS} brugere og ${FREE_MAX_ACTIVE_CLIENTS} aktive kunder, så længe du vil.`,
  },
  {
    question: "Hvad sker der med prøveperioden?",
    answer:
      "Nye konti får 30 dage med alle funktioner. Vælger du ikke en betalt plan bagefter, fortsætter du automatisk på Gratis uden at miste data.",
  },
  {
    question: "Kan jeg bruge den gratis version til mine ansatte?",
    answer: `Gratis har plads til ${FREE_MAX_SEATS} brugere, så et lille team kan registrere tid på de samme kunder. Skal ansattes arbejdstid, ferie og fravær registreres efter loven, kræver det Virksomhed-planen til ${BUSINESS_SEAT_PRICE_MONTHLY} kr. pr. bruger/md. ekskl. moms.`,
  },
  {
    question:
      "Hvad er forskellen på gratis tidsregistrering og en der fakturerer?",
    answer: `Et gratis værktøj registrerer timerne, men fakturaen skal du lave et andet sted. I TimeTrack Selvstændig til ${SUBSCRIPTION_PRICE_MONTHLY} kr./md. ekskl. moms bliver timerne til en faktura i Billy eller Dinero, og klippekort trækkes automatisk.`,
  },
  {
    question: "Er der reklamer?",
    answer: "Nej. TimeTrack har ingen reklamer, heller ikke på Gratis.",
  },
];

export default function GratisTidsregistreringPage() {
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
      title="Gratis tidsregistrering, der ikke udløber"
      subtitle={`Registrér din tid på web, telefon og i browseren. Gratis for op til ${FREE_MAX_SEATS} brugere med ${FREE_MAX_ACTIVE_CLIENTS} kunder, uden betalingskort og uden udløbsdato.`}
      jsonLd={faqSchema}
      faqItems={FAQ}
      relatedLinks={[
        {
          href: "/timeregistrering-app",
          title: "Tidsregistrering-app",
          description: "Registrér fra telefon, browser og desktop.",
        },
        {
          href: "/online-stopur",
          title: "Online stopur",
          description: "Tag tid uden at oprette en konto.",
        },
        {
          href: "/timeseddel-skabelon",
          title: "Timeseddel-skabelon",
          description: "Hvis du hellere vil bruge papir eller Excel.",
        },
        {
          href: "/hourtick-alternativ",
          title: "Hourtick alternativ",
          description: "Gratis til hele teamet, med fakturering og klippekort.",
        },
        {
          href: "/timer-til-faktura",
          title: "Fra timer til faktura",
          description: "Sådan bliver timerne til en faktura.",
        },
        {
          href: "/pricing",
          title: "Priser",
          description: "Sammenlign alle planer.",
        },
      ]}
      ctaTitle="Opret din gratis konto"
      ctaSubtitle="Det tager under et minut, og du kan starte timeren med det samme."
    >
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-balance text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Det får du gratis
          </h2>
          <ul className="mt-6 grid gap-3 text-lg text-gray-700 sm:grid-cols-2">
            {INCLUDED.map((item) => (
              <li key={item} className="flex gap-3">
                <span aria-hidden="true" className="text-green-600">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-lg leading-relaxed text-gray-700">
            Fakturering og klippekort er med på Gratis, inden for de 3 aktive
            kunder. Du kan også eksportere timerne og bruge dem som grundlag for
            en faktura, du laver et andet sted.
          </p>

          <h2 className="mt-16 text-balance text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Gratis tidsregistrering eller tidsregistrering, der fakturerer?
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-gray-700">
            Gratis værktøjer registrerer timer. TimeTrack gør dem til betalte
            fakturaer i Billy eller Dinero.
          </p>
          <div className="mt-6 overflow-hidden rounded-2xl border border-gray-200">
            <table className="w-full text-left text-sm sm:text-base">
              <thead className="bg-gray-50 text-gray-900">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Fra timer til betaling
                  </th>
                  <th
                    scope="col"
                    className="w-24 px-2 py-3 text-center font-semibold sm:w-36"
                  >
                    Gratis værktøj
                  </th>
                  <th
                    scope="col"
                    className="w-24 px-2 py-3 text-center font-semibold sm:w-36"
                  >
                    TimeTrack Selvstændig
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 text-gray-700">
                {FREE_VS_INVOICING.map((row) => (
                  <tr key={row.step}>
                    <th scope="row" className="px-4 py-3 font-normal">
                      {row.step}
                    </th>
                    {[row.free, row.paid].map((has, i) => (
                      <td
                        // biome-ignore lint/suspicious/noArrayIndexKey: fast to-kolonne-række
                        key={i}
                        className="px-2 py-3 text-center"
                      >
                        {has ? (
                          <span className="text-green-700">
                            <span aria-hidden="true">✓</span>
                            <span className="sr-only">Ja</span>
                          </span>
                        ) : (
                          <span className="text-gray-400">
                            <span aria-hidden="true">–</span>
                            <span className="sr-only">Nej</span>
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6 text-lg leading-relaxed text-gray-700">
            Med et gratis værktøj skal du selv flytte timerne over i
            regnskabsprogrammet, regne klippekortets saldo ud og huske, hvilke
            timer der allerede er faktureret. Det er tre steder, hvor timer kan
            blive væk. I TimeTrack laver du fakturaen ud fra timerne med det
            samme, og den lander i dit regnskabsprogram.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-gray-700">
            Du kan starte på Gratis med op til {FREE_MAX_SEATS} brugere og{" "}
            {FREE_MAX_ACTIVE_CLIENTS} kunder og skifte til Selvstændig til{" "}
            {SUBSCRIPTION_PRICE_MONTHLY} kr./md., den dag du vil fakturere.
            Timerne følger med. Overvejer du Hourtick, kan du læse en{" "}
            <Link
              href="/hourtick-alternativ"
              className="text-brand-700 underline"
            >
              ærlig sammenligning af Hourtick og TimeTrack
            </Link>
            .
          </p>

          <h2 className="mt-16 text-balance text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Hvornår giver det mening at betale?
          </h2>
          <div className="mt-6 divide-y divide-gray-200 rounded-2xl border border-gray-200">
            {UPGRADES.map((u) => (
              <div
                key={u.plan}
                className="grid gap-1 p-5 sm:grid-cols-[10rem_10rem_1fr] sm:gap-6"
              >
                <p className="font-semibold text-gray-900">{u.plan}</p>
                <p className="text-sm tabular-nums text-gray-700">{u.price}</p>
                <p className="text-gray-600">{u.when}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-gray-500">
            Priserne er ekskl. moms. Ingen binding.{" "}
            <Link href="/pricing" className="text-brand-700 underline">
              Se alle planer
            </Link>
          </p>

          <h2 className="mt-16 text-balance text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Gratis tidsregistrering eller regneark?
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-gray-700">
            Et regneark er gratis, men du skal selv huske at skrive tiden ind,
            og det er let at glemme en halv time her og der. En timer, du
            starter med ét klik på telefonen eller i browseren, fanger den tid,
            og du får ugens og månedens overblik uden at regne selv.
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
