import type { Metadata } from "next";
import Link from "next/link";
import { FeatureRows } from "@/components/marketing/FeatureRows";
import { mk } from "@/components/marketing/mk";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
} from "@/lib/billing/plan-limits";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

const TITLE = "Tidsregistrering: regler, krav og en nem løsning";
const DESCRIPTION =
  "Siden 1. juli 2024 skal danske arbejdsgivere registrere medarbejdernes daglige arbejdstid. Her er kravene, hvem der er omfattet, og hvordan I kommer i gang.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | TimeTrack` },
  description: DESCRIPTION,
  alternates: { canonical: "/tidsregistrering" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/tidsregistrering",
    type: "article",
  },
};

const REQUIREMENTS = [
  {
    title: "Daglig arbejdstid",
    text: "Den samlede arbejdstid skal registreres for hver medarbejder, hver dag. Det kan ske som start- og sluttid eller som afvigelser fra en fast norm.",
  },
  {
    title: "Objektivt",
    text: "Registreringen skal afspejle den faktiske arbejdstid og må ikke kunne ændres uden spor.",
  },
  {
    title: "Pålideligt",
    text: "Data må ikke gå tabt, og systemet skal give et retvisende billede.",
  },
  {
    title: "Tilgængeligt",
    text: "Både arbejdsgiver og medarbejder skal kunne se registreringerne. Medarbejderen skal have adgang til sine egne data.",
  },
  {
    title: "Opbevaring i 5 år",
    text: "Registreringerne skal gemmes i 5 år efter udløbet af den periode, de indgår i.",
  },
];

const STEPS = [
  {
    title: "Vælg, hvordan I registrerer",
    text: "Check ind og ud giver det mest præcise billede. Har I faste arbejdstider, kan I nøjes med at registrere afvigelser fra normen.",
  },
  {
    title: "Find jeres selvtilrettelæggere",
    text: "Medarbejdere, der selv fastlægger deres arbejdstid, typisk ledere, kan undtages. Undtagelsen skal fremgå af ansættelseskontrakten.",
  },
  {
    title: "Vælg et system, medarbejderne gider bruge",
    text: "Registreringen skal ske hver dag. Et system, der virker på telefonen og i browseren, gør det til et klik i stedet for en opgave.",
  },
  {
    title: "Fortæl medarbejderne, hvad der sker",
    text: "Forklar, hvorfor I registrerer, hvem der kan se data, og hvordan man retter en fejl. Det giver tillid og færre huller.",
  },
];

const FAQ = [
  {
    question: "Hvornår trådte loven om tidsregistrering i kraft?",
    answer:
      "Kravet om registrering af daglig arbejdstid gælder fra 1. juli 2024. Det står i arbejdstidslovens § 4 b og bygger på EU-Domstolens dom i sag C-55/18 fra 2019.",
  },
  {
    question: "Gælder kravet også for små virksomheder?",
    answer:
      "Ja. Kravet gælder alle arbejdsgivere med ansatte, uanset størrelse. Selvstændige uden ansatte er ikke omfattet.",
  },
  {
    question: "Skal ledere registrere deres arbejdstid?",
    answer:
      "Ikke nødvendigvis. Medarbejdere, hvis arbejdstid ikke måles eller fastlægges på forhånd, eller som selv kan fastlægge den, kan undtages. Det gælder typisk ledere, og undtagelsen skal stå i ansættelseskontrakten.",
  },
  {
    question: "Hvor længe skal registreringerne gemmes?",
    answer:
      "I 5 år efter udløbet af den periode, som danner grundlag for beregningen af den gennemsnitlige ugentlige arbejdstid.",
  },
  {
    question: "Er det TimeTrack, der opbevarer registreringerne i 5 år?",
    answer:
      "Nej. Pligten til at opbevare registreringerne i 5 år ligger hos arbejdsgiveren. TimeTrack gemmer registreringerne og historikken over rettelser, så længe kontoen findes, og du kan når som helst hente det hele som én fil. Hent filen, før du lukker kontoen.",
  },
  {
    question: "Må man nøjes med at registrere afvigelser?",
    answer:
      "Ja. Har medarbejderne en fast arbejdstid, kan I registrere afvigelser fra den, så længe systemet kan vise den samlede daglige arbejdstid.",
  },
  {
    question: "Er et regneark nok?",
    answer:
      "Loven kræver ikke et bestemt system. Men et regneark kan ændres uden spor, og det er svært at vise, at registreringen er objektiv og pålidelig. Et system med historik og medarbejderadgang er det sikre valg.",
  },
  {
    question: "Hvad er forskellen på tidsregistrering og timeregistrering?",
    answer:
      "Ordene bruges ofte om det samme. Tidsregistrering bruges oftest om arbejdstid, mens timeregistrering typisk handler om timer brugt på kunder og projekter, fx til fakturering.",
  },
];

// To-kolonne-række: overskrift til venstre, indhold til højre.
const row = `${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`;

export default function TidsregistreringPage() {
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
      title="Tidsregistrering: regler, krav og en nem løsning"
      subtitle="Siden 1. juli 2024 skal alle danske arbejdsgivere registrere medarbejdernes daglige arbejdstid. Her er, hvad loven kræver, og hvordan I kommer i gang uden bøvl."
      jsonLd={faqSchema}
      faqItems={FAQ}
      relatedLinks={[
        {
          href: "/virksomheder",
          title: "TimeTrack til virksomheder",
          description: "Check ind og ud, ferie, fravær og flex.",
        },
        {
          href: "/arbejdstimer-pr-maaned",
          title: "Arbejdstimer pr. måned",
          description: "Normtimer ved fuldtid og deltid.",
        },
        {
          href: "/arbejdsdage-2026",
          title: "Arbejdsdage 2026",
          description: "Arbejdsdage og helligdage måned for måned.",
        },
        {
          href: "/blog/tidsregistrering-lov-danmark",
          title: "Loven om tidsregistrering",
          description: "Uddybende gennemgang af reglerne.",
        },
        {
          href: "/timeregistrering",
          title: "Timeregistrering",
          description: "Timer pr. kunde og projekt til fakturering.",
        },
        {
          href: "/selvstaendig",
          title: "Tidsregistrering for selvstændige",
          description: "Klippekort og faktura ud fra timerne.",
        },
      ]}
      ctaTitle="Prøv tidsregistrering gratis"
      ctaSubtitle={`Start gratis for op til ${FREE_MAX_SEATS} brugere. Virksomheder med ansatte betaler ${PLAN_PRICES.virksomhed.price} ekskl. moms, uden oprettelsesgebyr.`}
    >
      <section className={mk.section}>
        <div className={mk.wrap}>
          <div className="max-w-3xl rounded-[14px] bg-tt-flade p-6 text-lg leading-relaxed text-tt-blaek sm:p-8">
            <strong>Kort svar:</strong> Tidsregistrering er registrering af,
            hvor meget der arbejdes. Siden 1. juli 2024 skal alle danske
            arbejdsgivere registrere hver medarbejders daglige arbejdstid i et
            system, der er objektivt, pålideligt og tilgængeligt.
            Registreringerne skal gemmes i 5 år.
          </div>
        </div>
      </section>

      <section className={mk.section}>
        <div className={row}>
          <h2 className={mk.h2}>Hvad er tidsregistrering?</h2>
          <div className={`${mk.body} space-y-4`}>
            <p>
              Tidsregistrering betyder, at man noterer, hvor lang tid der bliver
              arbejdet, og ofte også på hvad. For en virksomhed med ansatte er
              det i dag et lovkrav. For selvstændige er det grundlaget for
              fakturaen, og for alle andre er det den nemmeste måde at se, hvor
              tiden faktisk går hen.
            </p>
            <p>
              Man skelner ofte mellem registrering af <em>arbejdstid</em>, altså
              hvornår man arbejder, og registrering af tid på <em>opgaver</em>,
              altså hvad tiden bruges på. Et godt system kan begge dele på én
              gang.
            </p>
          </div>
        </div>
      </section>

      <FeatureRows
        title="Hvad kræver loven?"
        intro="Kravet står i arbejdstidslovens § 4 b og gennemfører EU-Domstolens dom i sag C-55/18. Loven bestemmer ikke, hvilket system I skal bruge, men systemet skal leve op til fem krav."
        items={REQUIREMENTS}
      />

      <section className={mk.section}>
        <div className={row}>
          <h2 className={mk.h2}>Hvem er omfattet?</h2>
          <div className={`${mk.body} space-y-4`}>
            <p>
              Kravet gælder alle arbejdsgivere med ansatte, også virksomheder
              med én medarbejder. Selvstændige uden ansatte er ikke omfattet.
            </p>
            <p>
              Medarbejdere, hvis arbejdstid ikke måles eller fastlægges på
              forhånd, eller som selv kan fastlægge den, kan undtages. Det
              gælder typisk ledere. Undtagelsen skal fremgå af
              ansættelseskontrakten, så det er en god idé at gennemgå
              kontrakterne, før I går i gang.
            </p>
          </div>
        </div>
      </section>

      <section className={mk.section}>
        <div className={row}>
          <h2 className={mk.h2}>Sådan kommer I i gang</h2>
          <ol className="border-t border-tt-streg">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                className="grid grid-cols-[2rem_1fr] gap-3 border-b border-tt-streg py-5"
              >
                <span className="font-semibold tabular-nums text-tt-gran">
                  {i + 1}.
                </span>
                <div>
                  <p className="font-semibold text-tt-blaek">{s.title}</p>
                  <p className={`${mk.body} mt-1`}>{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={mk.section}>
        <div className={row}>
          <h2 className={mk.h2}>
            Hvad skal et system til tidsregistrering kunne?
          </h2>
          <div className={mk.body}>
            <ul className="list-disc space-y-2 pl-6">
              <li>Registrering med ét klik fra telefon, browser og computer</li>
              <li>Historik, så ændringer kan spores</li>
              <li>Medarbejderens egen adgang til sine registreringer</li>
              <li>Ferie, fravær og helligdage, så normtiden bliver rigtig</li>
              <li>Godkendelse af timesedler og eksport til løn</li>
              <li>
                Eksport af registreringerne og historikken, så du kan opbevare
                dem i 5 år
              </li>
            </ul>
            <p className="mt-6">
              <Link href="/virksomheder" className={mk.link}>
                TimeTrack til virksomheder
              </Link>{" "}
              har check ind og ud, ferie, fravær, flex, godkendelser og
              løneksport, og medarbejderne kan registrere fra app, browser og
              desktop. Det koster {PLAN_PRICES.virksomhed.price} ekskl. moms.
              Database og backup i EU.
            </p>
          </div>
        </div>
      </section>

      <section className={mk.section}>
        <div className={row}>
          <h2 className={mk.h2}>Tidsregistrering for selvstændige</h2>
          <p className={mk.body}>
            Er du selvstændig uden ansatte, er du ikke omfattet af loven. Men
            præcise timer er forskellen på en faktura, kunden accepterer, og en
            du skal forklare. Med TimeTrack kan du registrere tid pr. kunde og
            projekt, sælge{" "}
            <Link href="/klippekort" className={mk.link}>
              klippekort
            </Link>{" "}
            og sende timerne videre til fakturaen. Du kan starte gratis med op
            til {FREE_MAX_ACTIVE_CLIENTS} kunder.
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
