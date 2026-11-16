import { FileText, Gavel, PhoneCall, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

const TITLE = "Timeregistrering for advokater: salær du kan dokumentere";
const DESCRIPTION =
  "Timeregistrering til små advokatkontorer og selvstændige advokater: tid pr. klient og sag, specificeret fakturagrundlag, timebudget på fastprissager og faktura via Billy eller Dinero.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "timeregistrering advokat",
    "tidsregistrering advokat",
    "advokat timepris",
    "salær advokat",
    "timeregistrering advokatkontor",
  ],
  alternates: { canonical: "/timeregistrering-advokat" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/timeregistrering-advokat",
    type: "website",
  },
};

const FAQ = [
  {
    question: "Hvorfor skal en advokat registrere tid så detaljeret?",
    answer:
      "Fordi salæret skal være rimeligt og kunne forklares. Klager en klient over salæret, kan Advokatnævnet tage stilling til det, og her er en specificeret opgørelse med dato, tid og beskrivelse den bedste dokumentation. Den samme specifikation forebygger også mange klager, fordi klienten kan se, hvad timerne gik til.",
  },
  {
    question: "Hvad koster en advokat i timen?",
    answer:
      "Offentligt opslåede prislister fra danske advokatkontorer ligger typisk fra cirka 1.500 til 3.600 kr. ekskl. moms i timen, hvor partnere ligger i toppen og juridiske assistenter langt lavere (set 1. oktober 2026). Mange kontorer tilbyder også fast pris på standardopgaver som testamente og skøde.",
  },
  {
    question: "Kan jeg registrere i 6-minutters enheder?",
    answer:
      "Du kan registrere ned på minuttet, og fakturagrundlaget viser decimaltimer. Automatisk afrunding sættes pr. kunde til 5, 10, 15, 30 eller 60 minutter. Faste 6-minutters enheder (0,1 time) er ikke en indstilling i dag, så bruger dit kontor dem, skal du runde manuelt.",
  },
  {
    question: "Kan jeg sælge klippekort som advokat?",
    answer:
      "Til erhvervsklienter med løbende rådgivning kan en forudbetalt timepakke være praktisk. Vær opmærksom på, at forudbetaling for arbejde, der endnu ikke er udført, kan være klientmidler efter Advokatsamfundets regler. Tjek reglerne, før du tager imod betaling på forskud. Et timebudget på sagen giver samme overblik uden forudbetaling.",
  },
  {
    question: "Erstatter TimeTrack et advokatsystem?",
    answer:
      "Nej. TimeTrack har ikke konflikttjek, dokumenthåndtering, klientkonto eller fristkalender. Det passer til den selvstændige advokat eller det lille kontor, der vil have enkel tidsregistrering og fakturering, og til jurister og compliance-rådgivere, der arbejder som konsulenter.",
  },
];

const PAINS = [
  {
    icon: PhoneCall,
    title: "De små ekspeditioner forsvinder",
    text: "Et opkald fra klienten, en mail til modparten, en hurtig rettelse i et udkast. Hver især 5-10 minutter, som sjældent bliver skrevet ned bagefter. Over en måned er det let flere timers salær.",
  },
  {
    icon: Scale,
    title: "Fastprissager uden overblik",
    text: "Skøder, testamenter og ægtepagter sælges ofte til fast pris. Uden tid på sagen ved du ikke, om prisen holder, eller om hver tredje sag i virkeligheden er underskudsgivende.",
  },
  {
    icon: FileText,
    title: "Salæret skal kunne forklares",
    text: "Klienten vil vide, hvad timerne gik til. En faktura med “juridisk bistand, 14 timer” inviterer til spørgsmål. En specifikation med dato og arbejde gør ikke.",
  },
];

const EKSEMPEL = [
  {
    dato: "2/9",
    tekst: "Gennemgang af købsaftale og tingbogsattest",
    timer: "1,50",
  },
  { dato: "3/9", tekst: "Telefonmøde med klient om forbehold", timer: "0,25" },
  {
    dato: "3/9",
    tekst: "Mail til ejendomsmægler om advokatforbehold",
    timer: "0,17",
  },
  { dato: "5/9", tekst: "Udarbejdelse af skøde og anmeldelse", timer: "1,25" },
  { dato: "9/9", tekst: "Opfølgning på frigivelse af købesum", timer: "0,33" },
];

export default function TimeregistreringAdvokatPage() {
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
      badge="Til advokater"
      title="Timeregistrering for advokater"
      subtitle="Registrér tid pr. klient og sag, også de korte opkald. Få et specificeret fakturagrundlag, der forklarer salæret, og send fakturaen til Billy eller Dinero."
      jsonLd={faqSchema}
      faqItems={FAQ.map((f) => ({
        question: f.question,
        answer: <p>{f.answer}</p>,
      }))}
      relatedLinks={[
        {
          href: "/minutter-til-timer",
          title: "Minutter til timer",
          description: "Omregn minutter til decimaltimer med tabel.",
        },
        {
          href: "/timeregistrering-revisor",
          title: "Timeregistrering for revisorer",
          description: "Fastprisaftaler, sæsonpres og ekstraarbejde.",
        },
        {
          href: "/fakturagrundlag",
          title: "Fakturagrundlag",
          description: "Fra registrerede timer til faktura med specifikation.",
        },
      ]}
      ctaTitle="Prøv TimeTrack på dine næste sager"
      ctaSubtitle={`Gratis for op til 3 brugere og 3 aktive kunder. Selvstændig koster ${PLAN_PRICES.selvstaendig.price}, Team ${PLAN_PRICES.team.price}, begge ekskl. moms.`}
    >
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Her forsvinder advokatens timer
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
            Sådan sætter du TimeTrack op til sager
          </h2>
          <ol className="list-decimal space-y-3 pl-6">
            <li>
              <strong>Klienten er en kunde.</strong> Erhvervskunder hentes med
              CVR-opslag, så navn og adresse er rigtige på fakturaen.
            </li>
            <li>
              <strong>Sagen er et projekt</strong>, fx “Skøde, Vestergade 12”
              eller “Lejekontrakt, genforhandling”. Hver sag kan have sin egen
              timepris, en fast pris eller et timebudget.
            </li>
            <li>
              <strong>Beskriv arbejdet, mens du gør det.</strong> Start timeren
              fra browseren, desktop-appen eller mobilen, eller skriv bagefter
              med fritekst: “20 min telefon med Hansen om forbehold”.
            </li>
            <li>
              <strong>Flere jurister?</strong> I Team kan partner, advokat og
              fuldmægtig have hver sin timepris, så den samme sag faktureres
              rigtigt, uanset hvem der har arbejdet på den.
            </li>
            <li>
              <strong>Fakturér.</strong> Fakturagrundlaget samler den
              ufakturerede tid pr. sag med dato og beskrivelse. Send det til{" "}
              <Link href="/billy" className="text-brand-600 underline">
                Billy
              </Link>
              ,{" "}
              <Link href="/dinero" className="text-brand-600 underline">
                Dinero
              </Link>{" "}
              eller{" "}
              <Link href="/e-conomic" className="text-brand-600 underline">
                e-conomic
              </Link>
              , eller eksportér som PDF.
            </li>
          </ol>
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Eksempel: specifikation på en ejendomshandel
          </h2>
          <p>
            Sådan ser specifikationen ud, når tiden er registreret løbende. Fem
            korte poster, hvor tre af dem ellers let var blevet glemt.
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Dato
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Arbejde
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Timer
                  </th>
                </tr>
              </thead>
              <tbody>
                {EKSEMPEL.map((l) => (
                  <tr key={l.tekst} className="border-t border-slate-200">
                    <td className="px-4 py-2">{l.dato}</td>
                    <td className="px-4 py-2">{l.tekst}</td>
                    <td className="px-4 py-2 text-right">{l.timer}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-300 bg-brand-50/60 font-semibold">
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2">I alt à 2.200 kr. ekskl. moms</td>
                  <td className="px-4 py-2 text-right">3,50</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            3,50 timer giver 7.700 kr. ekskl. moms. Er sagen solgt til fast
            pris, kan du se forskellen på den faste pris og den brugte tid, når
            sagen lukkes, og justere prisen på den næste.
          </p>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <div className="flex items-center gap-3">
            <Gavel className="h-8 w-8 text-brand-600" aria-hidden="true" />
            <h2 className="text-3xl font-bold text-slate-900">
              Hvornår TimeTrack ikke er nok
            </h2>
          </div>
          <p>
            Et advokatkontor med mange sager har brug for mere end
            tidsregistrering: konflikttjek, dokumentstyring, klientkonto,
            fristkalender og journal. Det har TimeTrack ikke. Har du brug for
            det, er et egentligt advokatsystem det rigtige valg.
          </p>
          <p>
            TimeTrack passer, når du er selvstændig advokat eller et kontor på
            få personer, der allerede bruger Billy, Dinero eller e-conomic til
            regnskabet og primært mangler at få tiden registreret og faktureret
            uden dobbeltarbejde. Det passer også til jurister, DPO’er og
            compliance-rådgivere, der arbejder som konsulenter på timebasis.
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
