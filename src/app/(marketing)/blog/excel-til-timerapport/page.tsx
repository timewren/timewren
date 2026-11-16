import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { mk } from "@/components/marketing/mk";
import { Navigation } from "@/components/Navigation";
import { appLinkHref } from "@/lib/config";
import {
  FREE_LIMITS,
  HOME_PRICE_LINE,
  PLAN_PRICES,
  TRIAL_DAYS,
  VAT_NOTE,
} from "@/lib/marketing/pricing-copy";

const TITLE = "Fra Excel til automatisk timerapport: en freelancers guide";
const DESCRIPTION =
  "Er dit Excel-ark ved at knække? Fem tegn på, at det er tid til at skifte til et tidsregistreringsværktøj, og en plan for at flytte over i fem trin.";
const PATH = "/blog/excel-til-timerapport";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  alternates: { canonical: PATH },
};

const h2 = "text-2xl font-bold tracking-[-0.02em] text-tt-blaek";
const h3 = `${mk.h3} text-tt-blaek`;

export default function ExcelTilTimerapportPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: TITLE,
    description: DESCRIPTION,
    author: {
      "@type": "Person",
      name: "Mads Holst Jensen",
      url: "https://www.linkedin.com/in/madsholstjensen/",
    },
    publisher: {
      "@type": "Organization",
      name: "TimeTrack",
      url: "https://timetrack.dk",
    },
    datePublished: "2026-01-15",
    dateModified: "2026-10-12",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://timetrack.dk${PATH}`,
    },
  };

  return (
    <div className={mk.page}>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: statisk JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <Navigation />

      <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
        <header>
          <Link
            href="/blog"
            className="text-sm font-medium text-tt-gran hover:text-tt-gran-moerk"
          >
            ← Tilbage til blog
          </Link>
          <h1 className={`${mk.h2} mt-4`}>
            Fra Excel til automatisk timerapport: en freelancers guide
          </h1>
          <p className={`${mk.lead} mt-4`}>
            Excel er et fint sted at starte. Men på et tidspunkt bruger du mere
            tid på arket, end arket sparer dig. Her er fem tegn på, at du er
            nået dertil, og hvordan jeg ville flytte over.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tt-graa">
            <span>Af Mads Holst Jensen</span>
            <span>15. januar 2026</span>
            <span>Opdateret 12. oktober 2026</span>
            <span>5 min læsetid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-[17px] leading-relaxed text-tt-graa [&_strong]:font-semibold [&_strong]:text-tt-blaek">
          <h2 className={h2}>Freelancerens Excel-ark</h2>
          <p>
            De fleste starter med Excel eller Google Sheets. Det giver mening:
            du kender værktøjet, det er gratis, og du kan bygge arket, som du
            vil have det.
          </p>
          <p>
            Det typiske ark har en kolonne til dato, en til kunde, en til
            projekt, en til timer og en til beskrivelse. Måske en formel, der
            summerer pr. kunde, og et faneblad pr. måned.
          </p>
          <p>
            Med få kunder fungerer det fint. Problemerne kommer, når der bliver
            flere kunder og projekter, og når arket skal bruges til andet end at
            tælle timer.
          </p>

          <h2 className={h2}>5 tegn på, at Excel er ved at knække</h2>

          <h3 className={h3}>1. Du glemmer at registrere timer</h3>
          <p>
            Excel kræver, at du aktivt åbner arket og taster. Sidder du i flow
            på et projekt, er det let at udskyde til fredag, og så ender du med
            at gætte. Et gæt er ikke et fakturagrundlag.
          </p>

          <h3 className={h3}>2. Formlerne går i stykker</h3>
          <p>
            En fejlplaceret celle, et slettet faneblad eller en kopi, der
            overskriver en sum, og tallene passer ikke længere. Det kan gå
            ubemærket hen, til fakturaen er sendt.
          </p>

          <h3 className={h3}>
            3. Du bruger tid på formatering i stedet for fakturering
          </h3>
          <p>
            Vil kunden se, hvad timerne er brugt på, skal du sortere, filtrere,
            kopiere og formatere. Excel er et regneark og ikke et
            rapportværktøj, så det arbejde laver du manuelt hver gang.
          </p>

          <h3 className={h3}>4. Du har ingen historik at slå op i</h3>
          <p>
            Hvad fakturerede du kunden i marts? Hvor lang tid tog den sidste
            opgave af samme slags? Med ét ark pr. måned må du åbne flere filer
            og lægge sammen. I et tidsregistreringsværktøj kan du slå det op pr.
            kunde og periode.
          </p>

          <h3 className={h3}>
            5. Kunden kan ikke selv se, hvad timerne er brugt på
          </h3>
          <p>
            Kunder vil gerne kunne se, hvad de betaler for. Med Excel
            eksporterer du, retter til og sender en PDF. I TimeTrack kan kunden
            logge ind i en{" "}
            <Link href="/kundeportal" className={mk.link}>
              kundeportal
            </Link>{" "}
            og se timer, fakturaer og klippekort-saldo. Du bestemmer selv, hvad
            der er synligt.
          </p>

          <h2 className={h2}>Hvad et tidsregistreringsværktøj giver dig</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>En timer</strong>, du starter og stopper, mens du
              arbejder, så du ikke registrerer bagefter.
            </li>
            <li>
              <strong>Kunde og projekt på hver registrering</strong>, så timerne
              er sorteret fra start.
            </li>
            <li>
              <strong>Rapporter pr. kunde og periode</strong>, uden at du skal
              formatere noget.
            </li>
            <li>
              <strong>Klippekort</strong> til faste aftaler, hvor kunden kan se
              saldoen i kundeportalen.
            </li>
            <li>
              <strong>Fakturakladde til Billy eller Dinero</strong>, bygget på
              de registrerede timer.
            </li>
            <li>
              <strong>Historik</strong>, du kan bruge, når du skal vurdere din
              timepris.
            </li>
          </ul>

          <h2 className={h2}>Sådan flytter du over fra Excel</h2>

          <h3 className={h3}>Trin 1: Opret dine aktive kunder og projekter</h3>
          <p>
            Tag listen fra arket, og opret de kunder, du arbejder for lige nu,
            og de projekter, du aktuelt fakturerer på. Du behøver ikke flytte
            alt fra dag 1.
          </p>

          <h3 className={h3}>Trin 2: Sæt din timepris</h3>
          <p>
            Angiv din timepris. Har du forskellige priser til forskellige kunder
            eller opgaver, så sæt dem nu. TimeTrack bruger prisen på projektet
            først, derefter kundens og til sidst din almindelige timepris.
          </p>

          <h3 className={h3}>Trin 3: Kør begge systemer i en uge</h3>
          <p>
            Registrér i det nye værktøj og i arket i en uge, og sammenlign
            tallene. Det giver tryghed, og det afslører fejl i opsætningen, før
            de når en faktura.
          </p>

          <h3 className={h3}>Trin 4: Stop med at vedligeholde arket</h3>
          <p>
            Når tallene stemmer, så arkivér arket og brug kun det nye system.
            Behold arket som arkiv, men hold ikke begge dele ved lige. Så mister
            du pointen.
          </p>

          <h3 className={h3}>Trin 5: Forbind regnskabet</h3>
          <p>
            Bruger du Billy eller Dinero, kan TimeTrack sende en fakturakladde
            med timerne som linjer, så du slipper for at kopiere og taste.
            Opsætningen er gennemgået i{" "}
            <Link href="/blog/billy-timeregistrering-guide" className={mk.link}>
              guiden til Billy
            </Link>
            .
          </p>

          <h2 className={h2}>Hvad med de gamle data?</h2>
          <p>
            Du behøver ikke flytte hele historikken. Jeg ville beholde arket som
            arkiv og kun flytte det, du skal bruge fremover, for eksempel timer,
            der endnu ikke er faktureret.
          </p>
          <p>
            Vil du have historikken med, kan TimeTrack importere
            tidsregistreringer fra en CSV-fil. Gem arket som CSV, vælg hvilke
            kolonner der er dato, timer og beskrivelse (og eventuelt projekt og
            kunde), og se en forhåndsvisning, før noget bliver oprettet. Knappen
            hedder Importér CSV og ligger på Tid-siden.
          </p>

          <h2 className={h2}>Regn selv efter</h2>
          <p>
            Det handler ikke om teknologi. Det handler om tid. Tag den tid, du
            bruger på at taste, formatere og rette i arket hver måned, og gang
            med din timepris. Så ved du, hvad arket koster dig i fakturerbar
            tid. Sæt tallet op mod prisen på et værktøj.
          </p>
          <p>
            Som freelancer bruger du planen Selvstændig. Den koster{" "}
            {PLAN_PRICES.selvstaendig.price} og har klippekort og fakturering.{" "}
            {VAT_NOTE} {FREE_LIMITS}
          </p>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-[14px] bg-tt-flade p-8">
          <h2 className={h2}>Prøv TimeTrack ved siden af arket</h2>
          <p className="mt-2 text-tt-graa">
            Opret din første kunde, og registrér timerne begge steder i en uge.
          </p>
          <Link
            href={appLinkHref("/register")}
            className={`${mk.btnPrimary} mt-6`}
          >
            Prøv gratis i {TRIAL_DAYS} dage
          </Link>
          <p className={`${mk.fine} mt-4`}>{HOME_PRICE_LINE}</p>
        </div>

        {/* Related links */}
        <div className="mt-12 border-t border-tt-streg pt-8">
          <h2 className="text-xl font-bold text-tt-blaek">
            Relaterede artikler
          </h2>
          <ul className="mt-4 space-y-2">
            <li>
              <Link
                href="/blog/timeregistrering-freelancer-guide"
                className={mk.link}
              >
                Timeregistrering som freelancer: den komplette guide
              </Link>
            </li>
            <li>
              <Link
                href="/blog/billy-timeregistrering-guide"
                className={mk.link}
              >
                Billy og TimeTrack: send registrerede timer til en fakturakladde
              </Link>
            </li>
            <li>
              <Link
                href="/blog/fakturering-fejl-freelancer"
                className={mk.link}
              >
                5 fakturerings-fejl freelancere laver (og hvordan du undgår dem)
              </Link>
            </li>
          </ul>
        </div>
      </article>

      <Footer />
    </div>
  );
}
