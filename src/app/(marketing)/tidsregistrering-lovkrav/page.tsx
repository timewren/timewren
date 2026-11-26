import type { Metadata } from "next";
import Link from "next/link";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { BUSINESS_SEAT_PRICE_MONTHLY, getMarketingUrl } from "@/lib/config";

// Retstilstanden er tjekket 1/10-2026 mod lovbekendtgørelse nr. 982 af
// 12/08/2024 på retsinformation.dk (status: gældende). Opdatér datoen og
// teksten, når siden revideres, eller hvis loven ændres.
const OPDATERET_ISO = "2026-10-01";
const OPDATERET_TEKST = "1. oktober 2026";

const KILDER = {
  lbk: "https://www.retsinformation.dk/eli/lta/2024/982",
  aendringslov: "https://www.retsinformation.dk/eli/lta/2024/89",
  lovforslag: "https://www.ft.dk/samling/20231/lovforslag/L68/index.htm",
  eudom: "https://curia.europa.eu/juris/liste.jsf?num=C-55/18",
};

const TITLE = "Lovkrav om tidsregistrering af medarbejdere";
const DESCRIPTION =
  "Siden 1. juli 2024 skal danske arbejdsgivere registrere medarbejdernes daglige arbejdstid. Hvad kræver loven, hvem er omfattet, hvad med selvtilrettelæggere, og hvad sker der, hvis man ikke registrerer? Med links til lovteksten.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "tidsregistrering af medarbejdere",
    "tidsregistrering lovkrav",
    "arbejdstidsregistrering",
    "registrering af arbejdstid",
    "lov om tidsregistrering",
    "arbejdstidsloven",
  ],
  alternates: { canonical: "/tidsregistrering-lovkrav" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/tidsregistrering-lovkrav",
    type: "article",
  },
};

const FAQ = [
  {
    question: "Er det lovpligtigt at registrere medarbejdernes arbejdstid?",
    answer:
      "Ja. Siden 1. juli 2024 skal arbejdsgiveren have et objektivt, pålideligt og tilgængeligt system, der kan måle den daglige arbejdstid for hver medarbejder. Kravet står i § 4 b i lov om gennemførelse af dele af arbejdstidsdirektivet.",
  },
  {
    question: "Hvor længe skal registreringerne gemmes?",
    answer:
      "I 5 år efter udløbet af den periode, som 48-timers-reglen beregnes over. Medarbejderen skal samtidig kunne se sine egne oplysninger i systemet.",
  },
  {
    question: "Skal faste medarbejdere med faste arbejdstider også registrere?",
    answer:
      "Ja, men loven bestemmer ikke metoden. Det fremgår af lovarbejdet og ministeriets svar, at et system, hvor den aftalte arbejdstid er registreret på forhånd og kun afvigelser registreres, kan opfylde kravet.",
  },
  {
    question: "Gælder loven for mig som selvstændig uden ansatte?",
    answer:
      "Nej. Loven gælder for lønmodtagere, altså personer, der får løn for personligt arbejde i et ansættelsesforhold. Har du ingen ansatte, har du ingen at registrere for. Ansætter du nogen, også på deltid, gælder kravet for dem.",
  },
  {
    question: "Er der bøder, hvis man ikke registrerer arbejdstiden?",
    answer:
      "Nej. Loven har ingen bødebestemmelse, og ifølge lovforslagets bemærkninger kan der ikke tilkendes godtgørelse alene for manglende registrering. Mangler registreringen, kan det til gengæld få processuel skadevirkning for arbejdsgiveren, hvis en medarbejder rejser en sag om fx overarbejde eller hviletid. Krænkes medarbejderens rettigheder efter loven, fx 48-timers-reglen, kan der tilkendes en godtgørelse (§ 8). For overenskomstdækkede medarbejdere behandles sagen normalt fagretligt.",
  },
  {
    question: "Er det her juridisk rådgivning?",
    answer:
      "Nej. Siden er en oversigt over reglerne, som de står i lovteksten. Er du i tvivl om, hvordan reglerne gælder for jeres overenskomst eller en bestemt medarbejdergruppe, så spørg jeres arbejdsgiverorganisation eller en advokat.",
  },
];

const ekstern = {
  className: "text-brand-600 underline",
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

export default function TidsregistreringLovkravPage() {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: TITLE,
      description: DESCRIPTION,
      datePublished: OPDATERET_ISO,
      dateModified: OPDATERET_ISO,
      author: { "@type": "Person", name: "Mads Holst Jensen" },
      publisher: {
        "@type": "Organization",
        name: "TimeTrack",
        url: "https://timetrack.dk",
      },
      mainEntityOfPage: new URL("/tidsregistrering-lovkrav", getMarketingUrl())
        .href,
      citation: Object.values(KILDER),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    },
  ];

  return (
    <SEOPageLayout
      badge={`Guide · Opdateret ${OPDATERET_TEKST}`}
      title="Lovkrav om tidsregistrering af medarbejdere"
      subtitle="Siden 1. juli 2024 skal danske arbejdsgivere registrere medarbejdernes daglige arbejdstid. Her er reglerne kort og præcist, med henvisning til lovteksten."
      jsonLd={jsonLd}
      faqItems={FAQ.map((f) => ({
        question: f.question,
        answer: <p>{f.answer}</p>,
      }))}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Videre herfra:"
      relatedLinks={[
        {
          href: "/virksomheder",
          title: "TimeTrack til virksomheder",
          description: "Check ind og ud, fravær, flex og godkendelser.",
        },
        {
          href: "/blog/tidsregistrering-medarbejdere-systemer",
          title: "8 systemer sammenlignet",
          description: "Pris, opstart og funktioner side om side.",
        },
        {
          href: "/timeregistrering-haandvaerker",
          title: "Timeregistrering for håndværkere",
          description: "Fra timeseddel på pladsen til faktura.",
        },
      ]}
      ctaTitle="Arbejdstidsregistrering, medarbejderne faktisk bruger"
      ctaSubtitle={`Check ind og ud, timesedler med godkendelse, fravær og et overblik over 48-timers-reglen og hviletid. Virksomhed koster ${BUSINESS_SEAT_PRICE_MONTHLY} kr. pr. bruger om måneden ekskl. moms, fra 5 brugere.`}
    >
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-5">
            <h2 className="text-lg font-semibold text-slate-900">
              Kort fortalt
            </h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Gælder fra <strong>1. juli 2024</strong> som udgangspunkt for
                alle arbejdsgivere med lønmodtagere.
              </li>
              <li>
                Arbejdsgiveren skal have et{" "}
                <strong>objektivt, pålideligt og tilgængeligt</strong> system,
                der kan måle den <strong>daglige arbejdstid</strong> for hver
                medarbejder.
              </li>
              <li>
                Medarbejderen skal kunne{" "}
                <strong>se sine egne registreringer</strong>.
              </li>
              <li>
                Registreringerne skal <strong>gemmes i 5 år</strong> efter
                udløbet af den periode, som 48-timers-reglen beregnes over.
              </li>
              <li>
                Loven bestemmer ikke metoden. Registrering af afvigelser fra en
                fast arbejdstid kan være nok.
              </li>
            </ul>
            <p className="mt-3 text-sm text-slate-600">
              Retstilstanden er tjekket {OPDATERET_TEKST} mod den gældende
              lovbekendtgørelse på retsinformation.dk. Siden er ikke juridisk
              rådgivning.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Hvorfor kom kravet?
          </h2>
          <p>
            EU-Domstolen afgjorde den 14. maj 2019 i sag C-55/18 (CCOO mod
            Deutsche Bank), at medlemslandene skal pålægge arbejdsgivere at
            indføre et system, der måler den daglige arbejdstid for hver
            arbejdstager. Uden registrering kan man ikke kontrollere, om
            reglerne i arbejdstidsdirektivet om maksimal ugentlig arbejdstid og
            hviletid bliver overholdt.
          </p>
          <p>
            I Danmark blev dommen gennemført med lov nr. 89 af 30. januar 2024
            (lovforslag L 68), som trådte i kraft den 1. juli 2024. Kravet står
            nu i § 4 b i lov om gennemførelse af dele af arbejdstidsdirektivet,
            senest bekendtgjort som lovbekendtgørelse nr. 982 af 12. august
            2024. Loven kaldes ofte bare arbejdstidsloven.
          </p>
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Hvad kræver loven?
          </h2>
          <p>Lovens § 4 b har tre krav til arbejdsgiveren:</p>
          <ol className="list-decimal space-y-3 pl-6">
            <li>
              <strong>Et registreringssystem.</strong> Arbejdsgiveren skal
              indføre et objektivt, pålideligt og tilgængeligt
              arbejdstidsregistreringssystem, der gør det muligt at måle den
              daglige arbejdstid for hver enkelt medarbejder (stk. 1).
            </li>
            <li>
              <strong>Adgang for medarbejderen.</strong> Medarbejderen skal
              kunne tilgå sine egne oplysninger i systemet (stk. 2).
            </li>
            <li>
              <strong>Opbevaring i 5 år.</strong> Oplysningerne skal gemmes i 5
              år efter udløbet af den periode, der ligger til grund for
              beregningen af den gennemsnitlige ugentlige arbejdstid (stk. 3).
            </li>
          </ol>
          <p>
            Formålet er at kunne dokumentere, at reglerne om arbejdstid og hvile
            bliver overholdt:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>48-timers-reglen:</strong> den gennemsnitlige ugentlige
              arbejdstid må ikke overstige 48 timer inklusive overarbejde,
              beregnet over en periode på 4 måneder (lovens § 4). Perioder med
              betalt ferie og sygefravær er neutrale i beregningen.
            </li>
            <li>
              <strong>Daglig og ugentlig hvile:</strong> reglerne om 11 timers
              hvile i døgnet og et ugentligt fridøgn står i arbejdsmiljøloven.
            </li>
          </ul>
          <h3 className="pt-2 text-xl font-semibold text-slate-900">
            Metodefrihed
          </h3>
          <p>
            Loven siger ikke, hvordan tiden skal registreres. Det kan være check
            ind og ud, en timeseddel eller et skema. Af lovarbejdet og
            Beskæftigelsesministeriets svar til Folketinget fremgår det, at det
            kan være nok at registrere den aftalte arbejdstid på forhånd, fx ud
            fra en vagtplan eller faste arbejdstider, og så registrere
            afvigelser, når de sker.
          </p>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Hvem er omfattet?
          </h2>
          <p>
            Loven gælder for lønmodtagere, det vil sige personer, der får løn
            for personligt arbejde i et ansættelsesforhold (§ 2). Det omfatter
            som udgangspunkt både funktionærer, timelønnede, deltidsansatte og
            studentermedhjælpere. Der er nogle undtagelser og særregler:
          </p>
          <ul className="list-disc space-y-3 pl-6">
            <li>
              <strong>Selvtilrettelæggere.</strong> Hvis arbejdstidens længde på
              grund af arbejdets særlige karakter ikke måles eller fastsættes på
              forhånd, eller medarbejderen selv kan fastsætte den, fordi
              vedkommende træffer selvstændige beslutninger eller har
              ledelsesfunktioner, gælder lovens §§ 3, 4 og 5 ikke, herunder
              48-timers-reglen (§ 1, stk. 6). Det skal fremgå af
              ansættelseskontrakten. Undtagelsen er snæver, og den gælder ikke
              bare fordi en medarbejder har fleksible mødetider. Ifølge
              lovforslagets bemærkninger gælder registreringskravet ikke for
              medarbejdere, der både er undtaget fra 48-timers-reglen og fra
              hviletidsreglerne i arbejdsmiljølovgivningen. Er medarbejderen
              stadig omfattet af hviletidsreglerne, skal arbejdstiden
              registreres. Er I i tvivl, så spørg jeres
              arbejdsgiverorganisation.
            </li>
            <li>
              <strong>Overenskomster.</strong> Er medarbejderne dækket af en
              kollektiv overenskomst, der sikrer direktivets rettigheder, kan
              reglerne om pauser, 48 timer og natarbejde følge af overenskomsten
              i stedet for loven (§ 1, stk. 2). Registreringskravet i § 4 b er
              ikke nævnt i den undtagelse. Tjek jeres overenskomst.
            </li>
            <li>
              <strong>Vejtransport.</strong> Mobile lønmodtagere, der er
              omfattet af EU's køre- og hviletidsregler for vejtransport, er
              ikke omfattet af loven (§ 1, stk. 4).
            </li>
            <li>
              <strong>Selvstændige uden ansatte</strong> er ikke lønmodtagere og
              er derfor ikke omfattet. Det samme gælder freelancere, du køber
              ydelser af, så længe de ikke er ansat.
            </li>
          </ul>
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Hvad sker der, hvis man ikke registrerer?
          </h2>
          <p>
            Loven har ingen bødebestemmelse, og ifølge lovforslagets
            bemærkninger kan der heller ikke tilkendes godtgørelse alene for at
            overtræde registreringspligten. Mangler registreringen, kan det dog
            få processuel skadevirkning for arbejdsgiveren i en sag om fx
            overarbejde eller hviletid, så arbejdsgiveren står svagt
            bevismæssigt. Krænkes en medarbejders rettigheder efter loven, kan
            medarbejderen tilkendes en godtgørelse, og en medarbejder, der
            bliver afskediget for at have rejst krav efter loven, har krav på
            godtgørelse (§ 8).
          </p>
          <p>
            Efter denne lov har Arbejdstilsynet en rolle i én særlig situation:
            hvor medarbejdere efter § 4 a har sagt ja til at arbejde mere end 48
            timer i gennemsnit om ugen. Så skal arbejdsgiveren føre ajourførte
            registre og stille dem til rådighed for Arbejdstilsynet (§ 4 b, stk.
            4).
          </p>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Sådan understøtter TimeTrack Virksomhed reglerne
          </h2>
          <p>
            Planen{" "}
            <Link href="/virksomheder" className="text-brand-600 underline">
              Virksomhed
            </Link>{" "}
            er bygget til at registrere arbejdstid for medarbejdere. Sådan
            hænger funktionerne sammen med kravene:
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Krav
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    I TimeTrack
                  </th>
                </tr>
              </thead>
              <tbody className="align-top">
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-3 font-medium">
                    Mål den daglige arbejdstid
                  </th>
                  <td className="px-4 py-3">
                    Check ind og ud med start- og sluttidspunkt, eller en
                    ugentlig timeseddel. Normtid pr. medarbejder, så man kan
                    nøjes med at registrere afvigelser.
                  </td>
                </tr>
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-3 font-medium">
                    Objektivt og pålideligt
                  </th>
                  <td className="px-4 py-3">
                    Medarbejderen indsender ugen, og lederen godkender den.
                    Ændres en godkendt registrering, går den tilbage til
                    godkendelse, og perioder kan låses. Ændringer gemmes i en
                    hændelseslog med hvem, hvornår og hvad der blev ændret.
                  </td>
                </tr>
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-3 font-medium">
                    Adgang for medarbejderen
                  </th>
                  <td className="px-4 py-3">
                    Hver medarbejder ser sine egne timesedler, check-ind, fravær
                    og saldi og kan eksportere sine egne data som CSV.
                  </td>
                </tr>
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-3 font-medium">
                    48 timer, 11 timers hvile og fridøgn
                  </th>
                  <td className="px-4 py-3">
                    Et overblik over regeloverholdelse beregner gennemsnittet
                    over en referenceperiode på 4 eller 12 måneder, hvor ferie
                    og sygdom holdes neutrale, og finder brud på hviletid og
                    fridøgn. Hver regel kan sættes til fra, advarsel eller
                    blokering.
                  </td>
                </tr>
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-3 font-medium">
                    Selvtilrettelæggere
                  </th>
                  <td className="px-4 py-3">
                    Medarbejdere kan markeres som selvtilrettelæggere og vises
                    som undtaget i overblikket. Ændringen logges.
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-3 font-medium">
                    Opbevaring
                  </th>
                  <td className="px-4 py-3">
                    Fratrådte medarbejdere arkiveres i stedet for at blive
                    slettet, så registreringerne kan gemmes og findes frem igen.
                    Det er stadig arbejdsgiveren, der skal sikre, at de gemmes i
                    5 år.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-slate-600">
            Et system gør ikke i sig selv en virksomhed lovlig. Det er stadig
            arbejdsgiveren, der skal sørge for, at tiden bliver registreret, og
            at undtagelser som selvtilrettelæggere er aftalt i kontrakten.
          </p>
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-4 text-slate-700">
          <h2 className="text-2xl font-bold text-slate-900">Kilder</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <a href={KILDER.lbk} {...ekstern}>
                Lovbekendtgørelse nr. 982 af 12. august 2024 om gennemførelse af
                dele af arbejdstidsdirektivet
              </a>{" "}
              (retsinformation.dk, gældende)
            </li>
            <li>
              <a href={KILDER.aendringslov} {...ekstern}>
                Lov nr. 89 af 30. januar 2024 (indførelse af registreringskrav)
              </a>
            </li>
            <li>
              <a href={KILDER.lovforslag} {...ekstern}>
                Lovforslag L 68 (2023-24) med bemærkninger og ministersvar
              </a>{" "}
              (ft.dk)
            </li>
            <li>
              <a href={KILDER.eudom} {...ekstern}>
                EU-Domstolens dom af 14. maj 2019 i sag C-55/18, CCOO
              </a>{" "}
              (curia.europa.eu)
            </li>
          </ul>
        </div>
      </section>
    </SEOPageLayout>
  );
}
