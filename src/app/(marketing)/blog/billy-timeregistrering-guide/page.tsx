import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { mk } from "@/components/marketing/mk";
import { Navigation } from "@/components/Navigation";
import { appLinkHref, getMarketingUrl } from "@/lib/config";
import {
  HOME_PRICE_LINE,
  PLAN_PRICES,
  TRIAL_DAYS,
  VAT_NOTE,
} from "@/lib/marketing/pricing-copy";

const TITLE =
  "Billy og TimeTrack: send registrerede timer til en fakturakladde";
const DESCRIPTION =
  "Sådan forbinder du Billy med TimeTrack via din API-nøgle og sender registrerede timer til Billy som fakturakladde. Opsætning, daglig brug og tre fælder at undgå.";
const PATH = "/blog/billy-timeregistrering-guide";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  alternates: { canonical: PATH },
};

const h2 = "text-2xl font-bold tracking-[-0.02em] text-tt-blaek";
const h3 = `${mk.h3} text-tt-blaek`;

export default function BillyTimeregistreringGuidePage() {
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
    datePublished: "2026-02-08",
    dateModified: "2026-10-12",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": new URL(PATH, getMarketingUrl()).href,
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
            Billy og TimeTrack: send registrerede timer til en fakturakladde
          </h1>
          <p className={`${mk.lead} mt-4`}>
            Billy kan fakturere, men ikke registrere tid. Her er, hvordan jeg
            ville sætte Billy og TimeTrack op, så timerne ender som en
            fakturakladde i Billy uden at blive tastet ind igen.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tt-graa">
            <span>Af Mads Holst Jensen</span>
            <span>8. februar 2026</span>
            <span>Opdateret 12. oktober 2026</span>
            <span>5 min læsetid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-[17px] leading-relaxed text-tt-graa [&_strong]:font-semibold [&_strong]:text-tt-blaek">
          <h2 className={h2}>Problemet: to systemer, der ikke taler sammen</h2>
          <p>
            Mange danske freelancere bruger Billy til regnskab og fakturering.
            Billy er dansk, enkelt og dækker det meste, en enkeltmandsvirksomhed
            har brug for.
          </p>
          <p>
            Men Billy har ikke tidsregistrering. Registrerer du timerne i Excel,
            i noter eller i et andet værktøj, skal du taste dem ind på fakturaen
            bagefter. Det giver to problemer:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Det tager tid.</strong> Du åbner to systemer, finder
              tallene og taster dem ind.
            </li>
            <li>
              <strong>Det giver fejl.</strong> En glemt time, en afrundingsfejl
              eller en linje, der ikke blev kopieret.
            </li>
          </ul>

          <h2 className={h2}>
            Løsningen: TimeTrack til timerne, Billy til regnskabet
          </h2>
          <p>
            Du registrerer tiden i TimeTrack. Når du vil fakturere, sender du
            timerne til Billy som en fakturakladde med timerne som
            fakturalinjer. Du gennemser kladden i Billy og sender den derfra.
          </p>
          <p>
            TimeTrack tager sig af det daglige: timer, kunder, projekter og
            klippekort. Billy tager sig af det sidste: at sende fakturaen,
            bogføre og holde styr på momsen.
          </p>

          <h2 className={h2}>Opsætning i tre trin</h2>
          <p>
            Fakturering er med på alle planer. Som freelancer bruger du typisk
            Selvstændig, som koster {PLAN_PRICES.selvstaendig.price} og har
            ubegrænset antal kunder. {VAT_NOTE}
          </p>

          <h3 className={h3}>Trin 1: Forbind Billy</h3>
          <p>
            I TimeTrack åbner du <strong>Indstillinger → Integrationer</strong>{" "}
            og finder Billy. Indsæt din API-nøgle, gem og tryk{" "}
            <strong>Test forbindelse</strong>. Nøglen finder du i Billy under{" "}
            <strong>Indstillinger → Integrationer → API</strong>.
          </p>

          <h3 className={h3}>Trin 2: Vælg standardprodukt</h3>
          <p>
            Billy kræver et produkt på hver fakturalinje. Når forbindelsen er
            oprettet, vælger du i TimeTrack, hvilket Billy-produkt timerne skal
            bruge. Har du ingen produkter i Billy, opretter TimeTrack et ved den
            første eksport.
          </p>
          <p>
            Sælger du klippekort, kan klippekort-tid få sit eget produkt. Så kan
            den bogføres anderledes end almindelige timer. Aftal bogføringen med
            din revisor eller bogholder.
          </p>

          <h3 className={h3}>Trin 3: Kunden findes eller oprettes i Billy</h3>
          <p>
            Første gang du sender en faktura for en kunde, leder TimeTrack efter
            kunden i Billy på CVR-nummer. Findes kunden ikke, oprettes den.
            Efter det husker TimeTrack koblingen. Har du allerede mange kunder i
            Billy, kan du hente dem ind i TimeTrack i stedet for at oprette dem
            to gange.
          </p>
          <p>
            Skriv kundens CVR-nummer i TimeTrack, før du sender den første
            faktura. Så kan TimeTrack finde en eksisterende kunde i Billy i
            stedet for at oprette en ny.
          </p>

          <h2 className={h2}>Det daglige flow</h2>

          <h3 className={h3}>Under arbejdet: registrér tiden</h3>
          <p>
            Du vælger kunde og projekt og starter timeren. Skifter du opgave,
            stopper du og starter en ny.
          </p>

          <h3 className={h3}>Når du vil fakturere: send til Billy</h3>
          <p>
            Opret en ny faktura for kunden, og vælg de tidsregistreringer, der
            skal med. Åbn fakturaen og tryk <strong>Send til Billy</strong>.
            Standarden er <strong>Opret kladde</strong>: TimeTrack opretter en
            fakturakladde i Billy med timerne som fakturalinjer. Du kan vælge én
            linje pr. opgave eller én samlet linje, og du kan styre, hvad
            teksten på linjerne skal indeholde.
          </p>
          <p>
            Dialogen har også valgene <strong>Godkend faktura</strong> og{" "}
            <strong>Send faktura</strong>. Jeg ville vælge kladden, så du når at
            tjekke tallene, før kunden ser dem. Gennemse kladden i Billy, og
            send den derfra.
          </p>
          <p>
            Hvor ofte du sender, er op til dig. Jeg ville vælge én fast rytme:
            enten en gang om ugen, for eksempel om fredagen, hvor du gennemgår
            ugens timer, eller når et projekt er afsluttet.
          </p>

          <h2 className={h2}>3 fælder, og hvordan du undgår dem</h2>

          <h3 className={h3}>1. Glemte timer</h3>
          <p>
            Et kort telefonopkald, en mailudveksling på en halv time, et
            uplanlagt møde. Registrér også de små ting, ellers når de aldrig
            fakturaen.
          </p>

          <h3 className={h3}>2. Forkert timepris</h3>
          <p>
            Tjek, at timeprisen passer med det, du har aftalt med kunden, før du
            sender. TimeTrack bruger prisen på projektet først, derefter kundens
            og til sidst din almindelige timepris. Har du forskellige priser til
            forskellige opgaver, så lav separate projekter med hver sin pris.
          </p>

          <h3 className={h3}>3. Moms</h3>
          <p>
            TimeTrack sætter ikke moms på de enkelte linjer. Det gør Billy ud
            fra indstillingerne i din konto, så tjek momsen på kladden, før du
            sender den. Standardsatsen er 25 %, men har du kunder i andre
            EU-lande eller uden for EU, kan reglerne være andre.
          </p>

          <h2 className={h2}>Det får du ud af det</h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>Du taster ikke timerne ind i Billy en gang til.</li>
            <li>
              Færre fejl, fordi tallene kommer direkte fra dine registreringer.
            </li>
            <li>
              Kunden kan få en specificeret faktura, hvis du lader linjerne
              følge opgaverne.
            </li>
          </ul>

          <h2 className={h2}>Bruger du Dinero?</h2>
          <p>
            TimeTrack kan også sende en fakturakladde til Dinero. Du forbinder
            Dinero under <strong>Indstillinger → Integrationer</strong>, og på
            fakturaen trykker du <strong>Send til Dinero</strong>. Også her er
            standarden at oprette en kladde. Læs mere i{" "}
            <Link
              href="/blog/dinero-timeregistrering-guide"
              className={mk.link}
            >
              guiden til Dinero
            </Link>
            .
          </p>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-[14px] bg-tt-flade p-8">
          <h2 className={h2}>Send din første fakturakladde til Billy</h2>
          <p className="mt-2 text-tt-graa">
            Prøv det med én kunde: registrér et par timer, og send dem til Billy
            som kladde.
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
              <Link href="/blog/excel-til-timerapport" className={mk.link}>
                Fra Excel til automatisk timerapport: en freelancers guide
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
