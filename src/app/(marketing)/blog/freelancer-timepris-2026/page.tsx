import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { mk } from "@/components/marketing/mk";
import { Navigation } from "@/components/Navigation";
import { appLinkHref, getMarketingUrl } from "@/lib/config";
import { HOME_PRICE_LINE, TRIAL_DAYS } from "@/lib/marketing/pricing-copy";

const TITLE = "Freelancer timepris 2026: sådan regner du din minimumssats ud";
const DESCRIPTION =
  "Sådan regner du din minimumssats som freelancer ud fra løn, udgifter og fakturerbare timer, og hvornår du bør hæve din timepris. Med et regneeksempel trin for trin.";
const PATH = "/blog/freelancer-timepris-2026";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  alternates: { canonical: PATH },
};

const h2 = "text-2xl font-bold tracking-[-0.02em] text-tt-blaek";
const h3 = `${mk.h3} text-tt-blaek`;

export default function FreelancerTimepris2026Page() {
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
    datePublished: "2026-02-22",
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
            Freelancer timepris 2026: sådan regner du din minimumssats ud
          </h1>
          <p className={`${mk.lead} mt-4`}>
            Der findes ikke ét rigtigt svar på, hvad en freelancer skal tage i
            timen. Her er den metode, jeg ville bruge til at finde din bund, og
            nogle tegn på, at prisen er for lav.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tt-graa">
            <span>Af Mads Holst Jensen</span>
            <span>22. februar 2026</span>
            <span>Opdateret 12. oktober 2026</span>
            <span>5 min læsetid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-[17px] leading-relaxed text-tt-graa [&_strong]:font-semibold [&_strong]:text-tt-blaek">
          <h2 className={h2}>Hvad tager andre?</h2>
          <p>
            Spørger du fem freelancere, hvad de tager i timen, får du fem
            forskellige svar. Det er logisk: timeprisen afhænger af branche,
            erfaring, specialisering og hvilke kunder du arbejder for.
          </p>
          <p>
            Jeg skriver ikke en liste med gennemsnitspriser pr. branche her, for
            jeg har ikke en kilde, jeg kan stå inde for. Find i stedet dine egne
            pejlemærker: spørg kolleger i samme branche, og se, hvad
            konkurrenter offentliggør. Brug tallene som pejlemærke og ikke som
            facit.
          </p>

          <h2 className={h2}>Sådan regner du din minimumssats ud</h2>
          <p>
            Mange sætter timeprisen ud fra, hvad andre tager. Det er en start,
            men jeg ville regne på min egen bund først. Her er metoden. Tallene
            i eksemplerne er eksempler, så sæt dine egne ind. Du kan også bruge{" "}
            <Link href="/timepris-beregner" className={mk.link}>
              timepris-beregneren
            </Link>
            .
          </p>

          <h3 className={h3}>1. Regn dine årlige udgifter ud</h3>
          <p>
            Læg alt sammen: kontor, forsikring, pension, software, telefon,
            efteruddannelse, revisor og ferie (ja, ferie er en udgift, når du er
            selvstændig). Læg den løn oveni, du gerne vil have.
          </p>
          <p>
            <strong>Eksempel:</strong> 40.000 kr. pr. måned i ønsket løn og
            8.000 kr. pr. måned i faste udgifter giver 48.000 kr. pr. måned,
            altså 576.000 kr. pr. år.
          </p>

          <h3 className={h3}>2. Regn dine fakturerbare timer ud</h3>
          <p>
            Start med de timer, du faktisk kan arbejde på et år, når du har
            trukket ferie, helligdage og sygedage fra. Ikke alle de timer kan
            faktureres: salg, administration, bogføring og markedsføring tæller
            ikke med. Din egen faktureringsgrad er det bedste tal at bruge. Har
            du den ikke endnu, så gæt forsigtigt og ret tallet til, når du har
            registreret et par måneder.
          </p>
          <p>
            <strong>Eksempel:</strong> 1.700 arbejdstimer om året, hvoraf 65 %
            kan faktureres, giver 1.105 fakturerbare timer.
          </p>

          <h3 className={h3}>3. Divider</h3>
          <p>
            576.000 kr. delt med 1.105 timer er <strong>521 kr. i timen</strong>
            . Det er din bund. Under den sats taber du penge.
          </p>
          <p>
            Du bør ligge et stykke over, for du skal også have råd til sygedage,
            stille perioder og uventede udgifter. Læg en buffer oveni. I
            eksemplet bruger jeg 40 %: 521 kr. gange 1,4 er cirka{" "}
            <strong>730 kr. i timen</strong>.
          </p>

          <h2 className={h2}>4 faktorer, der påvirker din timepris</h2>

          <h3 className={h3}>1. Erfaring og specialisering</h3>
          <p>
            Jo mere specialiseret du er, jo mere kan du tage. En generalist
            konkurrerer på pris. En specialist konkurrerer på værdi.
          </p>

          <h3 className={h3}>2. Kundetype</h3>
          <p>
            Store virksomheder har ofte andre budgetter end små. Det er ikke
            ualmindeligt at have forskellige priser til forskellige kundetyper.
          </p>

          <h3 className={h3}>3. Projektlængde</h3>
          <p>
            Længere aftaler giver sikkerhed, og du bruger mindre tid på salg og
            opstart. Det kan være rimeligt at give en lille rabat for en lang
            aftale. Beslut rabatten på forhånd, så den ikke bliver et
            forhandlingsspørgsmål hver gang.
          </p>

          <h3 className={h3}>4. Hastighed</h3>
          <p>
            Hasteopgaver kan koste mere. Det er helt legitimt at have en
            hastesats, fordi kunden betaler for at komme foran i køen.
          </p>

          <h2 className={h2}>Hvornår skal du hæve timeprisen?</h2>
          <p>Tre tegn, jeg ville kigge efter:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Du har for meget at lave.</strong> Er du booket langt frem
              og må sige nej til forespørgsler, er prisen sandsynligvis for lav.
            </li>
            <li>
              <strong>Ingen siger nej.</strong> Accepterer alle dit tilbud uden
              forhandling, er du sandsynligvis for billig.
            </li>
            <li>
              <strong>Du har opbygget specialviden.</strong> En ny
              certificering, dybere erfaring eller en niche, du behersker, kan
              retfærdiggøre en højere pris.
            </li>
          </ul>
          <p>
            Jeg ville tage prisen op til vurdering mindst én gang om året. Nye
            kunder får den nye sats med det samme. Eksisterende kunder skal have
            besked i god tid, så de kan nå at reagere.
          </p>

          <h2 className={h2}>Kend dine egne tal</h2>
          <p>
            Det vigtigste for en god pris er, at du kender dine egne tal. Hvor
            mange timer bruger du reelt? Hvor stor en del kan du fakturere? Hvad
            tjener du i timen hos hver kunde?
          </p>
          <p>
            Uden tidsregistrering er svarene gæt. Når du registrerer, kan du
            bruge dine egne tal til at beslutte prisen og undgå at sælge din tid
            for billigt. I TimeTrack viser rapporten Dækningsgrad, hvor meget af
            din arbejdstid du har registreret, og hvor stor en del af den der er
            fakturerbar. Rapporten om reel timepris viser, hvad du tjener pr.
            time hos hver kunde.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-[14px] bg-tt-flade p-8">
          <h2 className={h2}>Kend din reelle timepris</h2>
          <p className="mt-2 text-tt-graa">
            Registrér timerne i en måned, så har du tal at regne med i stedet
            for gæt.
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
              <Link href="/blog/klippekort-freelancer" className={mk.link}>
                Klippekort til kunder: sådan sælger du forudbetalte timer
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
