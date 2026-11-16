import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { FounderNote } from "@/components/marketing/FounderNote";
import { HeroCta } from "@/components/marketing/home/HeroCta";
import { HeroKlippekort } from "@/components/marketing/home/HeroKlippekort";
import { HeroTimer } from "@/components/marketing/home/HeroTimer";
import { IntegrationsRow } from "@/components/marketing/home/IntegrationsRow";
import { LatestPosts } from "@/components/marketing/home/LatestPosts";
import { ProductShowcase } from "@/components/marketing/home/ProductShowcase";
import { Testimonials } from "@/components/marketing/home/Testimonials";
import { mk } from "@/components/marketing/mk";
import { SegmentRows } from "@/components/marketing/SegmentRows";
import { TrustBadge } from "@/components/marketing/TrustBadge";
import { Navigation } from "@/components/Navigation";
import { brand } from "@/lib/brand";
import { getMarketingUrl, SUBSCRIPTION_PRICE_MONTHLY } from "@/lib/config";
import {
  AFTER_TRIAL_SOLO,
  AFTER_TRIAL_SOLO_SHORT,
  AFTER_TRIAL_TEAM,
  FREE_LIMITS,
  HOME_PRICE_LINE,
  NO_STRINGS,
  PLAN_PRICES,
  TRIAL_DAYS,
  VAT_NOTE,
} from "@/lib/marketing/pricing-copy";

const TITLE = "Tidsregistrering med klippekort til selvstændige og bureauer";
const DESCRIPTION = `Dansk tidsregistrering, der trækker timerne fra kundens klippekort og laver fakturagrundlaget til Billy eller Dinero. Prøv gratis i ${TRIAL_DAYS} dage. Selvstændig ${PLAN_PRICES.selvstaendig.price} ekskl. moms.`;

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | TimeTrack` },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "da_DK",
    siteName: "TimeTrack",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

const KLIPPEKORT_TRIN = [
  {
    tal: "01",
    titel: "Kunden køber et klippekort",
    tekst:
      "Et antal timer betales på forhånd og ligger klar på kortet, så der ikke skal sendes en faktura for hver lille opgave.",
  },
  {
    tal: "02",
    titel: "Du registrerer tid, som du plejer",
    tekst:
      "Vælg kunden i timeren, i browserudvidelsen eller på telefonen, og TimeTrack trækker timerne fra klippekortet med det samme.",
  },
  {
    tal: "03",
    titel: "Fakturagrundlaget ligger klar",
    tekst:
      "Kunden kan altid se saldoen i kundeportalen. Når kortet er brugt, går grundlaget videre til Billy eller Dinero, eller kunden køber et nyt.",
  },
] as const;

const TOOLS = [
  { label: "Online stopur", href: "/online-stopur" },
  { label: "Arbejdstimer-beregner", href: "/arbejdstimer-beregner" },
  { label: "Timepris-beregner", href: "/timepris-beregner" },
  { label: "Timeseddel-skabelon", href: "/timeseddel-skabelon" },
];

const FAQ = [
  {
    q: "Hvad er tidsregistrering?",
    a: "Tidsregistrering betyder, at du noterer, hvor lang tid du bruger, og på hvad. Selvstændige bruger det til at fakturere rigtigt, teams til at se, hvor tiden går, og virksomheder til at opfylde kravet om registrering af arbejdstid.",
  },
  {
    q: "Hvad koster TimeTrack?",
    a: `Du kan prøve den plan, du vælger, gratis i ${TRIAL_DAYS} dage uden betalingskort. Selvstændig koster ${PLAN_PRICES.selvstaendig.price}, Team ${PLAN_PRICES.team.price} (${PLAN_PRICES.team.extra}), Virksomhed ${PLAN_PRICES.virksomhed.price} (${PLAN_PRICES.virksomhed.extra}) og Privat ${PLAN_PRICES.privat.price}. Årsbetaling svarer til 10 måneder. ${VAT_NOTE}`,
  },
  {
    q: "Hvad sker der efter de 30 dage?",
    a: `${AFTER_TRIAL_SOLO} ${FREE_LIMITS} ${AFTER_TRIAL_TEAM}`,
  },
  {
    q: "Kan TimeTrack bruges til den lovpligtige registrering af arbejdstid?",
    a: "Ja. Siden 1. juli 2024 skal danske arbejdsgivere have et system, der registrerer medarbejdernes daglige arbejdstid. Virksomhed-planen har check ind og ud, ferie, fravær, flex og godkendelser, og medarbejderne kan altid se deres egne registreringer.",
  },
  {
    q: "Findes der en app til telefonen?",
    a: "TimeTrack virker i telefonens browser, og du kan lægge den på hjemmeskærmen. Apps til iPhone og Android er i beta, og du kan melde dig som betatester. Browserudvidelsen til Chrome og Edge og desktop-appen til Mac og Windows findes allerede. Alle apps er med i alle planer, også Gratis.",
  },
  {
    q: "Kan jeg lave fakturaer ud fra mine timer?",
    a: "Ja, på alle planer. Fakturagrundlaget sendes som en kladde til Billy eller Dinero, eller du henter det som PDF og CSV. Du kan også sælge klippekort, hvor kunden køber timer på forhånd, og TimeTrack trækker forbruget automatisk.",
  },
  {
    q: "Hvor ligger mine data?",
    a: "Databasen ligger hos Hetzner i Tyskland, og filer og backup ligger hos Hetzner i Finland. Enkelte underleverandører, fx til mail og fejlrapporter, er amerikanske. Den fulde liste står på timetrack.dk/tillid. Du kan altid eksportere eller slette dine data.",
  },
  {
    q: "Tager TimeTrack skærmbilleder eller overvåger, hvad jeg laver?",
    a: "Nej. TimeTrack tager ingen skærmbilleder og registrerer ikke tastetryk eller museklik. I et team ser lederen de timer og det fravær, medarbejderne selv registrerer, men ikke hvad de laver på computeren. Desktop-appens aktivitetslog over programmer og vinduer bliver på din egen computer. Læs mere på timetrack.dk/tillid.",
  },
  {
    q: "Er der binding?",
    a: "Nej, ikke på månedsabonnementet. Du kan opsige, når du vil, og ophører et abonnement, fortsætter du på Gratis uden at miste dine data. Der er intet oprettelsesgebyr.",
  },
];

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "TimeTrack",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web, Windows, macOS",
  description: DESCRIPTION,
  offers: {
    "@type": "AggregateOffer",
    priceCurrency: "DKK",
    lowPrice: "0",
    highPrice: String(SUBSCRIPTION_PRICE_MONTHLY),
    offerCount: 5,
  },
};

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "TimeTrack",
  url: getMarketingUrl(),
  logo: `${getMarketingUrl()}/apple-touch-icon.png`,
  description:
    "Dansk tidsregistrering med klippekort til selvstændige og små bureauer.",
  address: { "@type": "PostalAddress", addressCountry: "DK" },
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    availableLanguage: ["Danish"],
  },
};

function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: statisk JSON-LD
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default function LandingPage() {
  return (
    <div className={mk.page}>
      <JsonLd data={organizationSchema} />
      <JsonLd data={softwareSchema} />
      <JsonLd data={faqSchema} />

      <Navigation />

      <main>
        {/* Hero: klippekort-spørgsmålet, prisen over folden, founderen som støttelinje */}
        <section className="pt-28 pb-16 sm:pt-36 sm:pb-20">
          <div className={mk.wrap}>
            <TrustBadge />
            <h1 className={`${mk.h1} mt-4 max-w-4xl`}>
              Hvor mange timer har kunden tilbage?
            </h1>
            <div className="mt-10 grid items-start gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16 [&>*]:min-w-0">
              <div className="order-2 lg:order-1">
                <p className={`${mk.lead} max-w-xl`}>
                  TimeTrack trækker timerne fra kundens klippekort, mens du
                  arbejder. Kunden kan selv se saldoen, og når kortet er brugt,
                  ligger fakturagrundlaget klar til Billy eller Dinero.
                </p>
                <HeroCta />
                <p className={`${mk.fine} max-w-xl`}>{HOME_PRICE_LINE}</p>
                <FounderNote className="mt-9 max-w-xl" />
              </div>
              <div className="order-1 lg:order-2">
                <HeroKlippekort />
              </div>
            </div>
          </div>
        </section>

        <Testimonials />

        {/* Fra timer til faktura: ugeoversigten og kundeportalen lagdelt,
            i stedet for to separate, flade skærmbilleder. */}
        <section aria-labelledby="flow-heading" className={mk.section}>
          <div className={mk.wrap}>
            <div className="grid gap-6 lg:grid-cols-[1fr_1fr] lg:gap-16">
              <h2 id="flow-heading" className={mk.h2}>
                Fra timer til faktura
              </h2>
              <p className={`${mk.body} max-w-xl lg:pt-3`}>
                Ugeoversigten viser, hvad du har registreret pr. kunde og dag,
                så du kan se, hvad der mangler, før du fakturerer. Timer på
                klippekort trækkes automatisk, og kunden kan selv følge saldoen
                i{" "}
                <Link href="/kundeportal" className={mk.link}>
                  kundeportalen
                </Link>
                . Fakturagrundlaget sendes som en kladde til Billy eller Dinero,
                og fakturerede timer låses, så de ikke ændres bagefter.
              </p>
            </div>
            <div className="mt-12 sm:mt-16">
              <ProductShowcase />
            </div>
            <IntegrationsRow />
          </div>
        </section>

        {/* Klippekortet i 3 trin: mørk grøn flade giver siden puls */}
        <section
          aria-labelledby="saadan-heading"
          className="bg-tt-gran-moerk py-20 sm:py-24"
        >
          <div className={mk.wrap}>
            <h2 id="saadan-heading" className={`${mk.h2} max-w-2xl text-white`}>
              Sådan virker klippekortet
            </h2>
            <ol className="mt-12 border-t border-white/15">
              {KLIPPEKORT_TRIN.map((trin) => (
                <li
                  key={trin.tal}
                  className="grid gap-3 border-b border-white/15 py-8 sm:grid-cols-[88px_1fr] sm:gap-10"
                >
                  <span className="text-[15px] font-bold text-brand-200 tabular-nums">
                    {trin.tal}
                  </span>
                  <div>
                    <h3 className="text-xl font-bold tracking-[-0.015em] text-white">
                      {trin.titel}
                    </h3>
                    <p className="mt-2 max-w-xl text-[17px] leading-relaxed text-white/75">
                      {trin.tekst}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Timeren uden konto: sekundær handling */}
        <section
          id="timer"
          aria-labelledby="timer-heading"
          className={`${mk.section} scroll-mt-20`}
        >
          <div
            className={`${mk.wrap} grid items-center gap-12 lg:grid-cols-2 lg:gap-16 [&>*]:min-w-0`}
          >
            <div>
              <h2 id="timer-heading" className={mk.h2}>
                Prøv timeren her, uden konto
              </h2>
              <p className={`${mk.lead} mt-5 max-w-xl`}>
                Den virker med det samme i browseren. Med en konto har du de
                samme timer i{" "}
                <Link href="/browser-extension" className={mk.link}>
                  browserudvidelsen
                </Link>
                , i{" "}
                <Link href="/desktop" className={mk.link}>
                  desktop-appen
                </Link>{" "}
                og på telefonen, hvor{" "}
                <Link href="/timeregistrering-app" className={mk.link}>
                  appen er i beta
                </Link>
                .
              </p>
            </div>
            <HeroTimer />
          </div>
        </section>

        {/* Segmenter med pris pr. spor */}
        <section aria-labelledby="spor-heading" className={mk.section}>
          <div className={mk.wrap}>
            <h2 id="spor-heading" className={mk.h2}>
              Til den måde, du arbejder på
            </h2>
            <SegmentRows className="mt-10" />
            <div className={`${mk.fine} mt-6 max-w-3xl space-y-2`}>
              <p>
                {VAT_NOTE} {NO_STRINGS}
              </p>
              <p>
                {AFTER_TRIAL_SOLO_SHORT} {FREE_LIMITS}
              </p>
              <p>{AFTER_TRIAL_TEAM}</p>
              <p>
                <Link href="/pricing" className={mk.link}>
                  Se alle priser og hvad der er med
                </Link>
              </p>
            </div>
          </div>
        </section>

        {/* Skriv til mig: jeg-form, stort portræt, tryghed */}
        <section aria-labelledby="mads-heading" className={mk.section}>
          <div
            className={`${mk.wrap} grid items-start gap-10 md:grid-cols-[280px_1fr] lg:grid-cols-[320px_1fr] lg:gap-16`}
          >
            <Image
              src="/brand/mads-portraet.jpg"
              alt="Mads Holst Jensen"
              width={640}
              height={800}
              className="aspect-[4/5] w-full max-w-[320px] rounded-[4px] object-cover"
              sizes="320px"
            />
            <div>
              <h2 id="mads-heading" className={mk.h2}>
                Skriv til mig, så svarer jeg
              </h2>
              <p className={`${mk.lead} mt-5 max-w-2xl`}>
                Jeg hedder Mads. Jeg begyndte at bygge TimeTrack, da det
                timeværktøj, jeg selv brugte, meldte, at det ville lukke. Da det
                senere blev købt og fortsatte, var TimeTrack næsten færdigt, og
                jeg valgte at gøre det færdigt.
              </p>
              <p className="mt-6">
                <a
                  href={`mailto:${brand.contactEmail}`}
                  className={mk.btnSecondary}
                >
                  Skriv til {brand.contactEmail}
                </a>
              </p>
              <ul className="mt-10 grid max-w-2xl gap-4">
                <li className="border-b border-tt-streg pb-4">
                  <span className="block font-semibold text-tt-blaek">
                    Ingen overvågning
                  </span>
                  <span className="text-[15px] text-tt-graa">
                    Ingen skærmbilleder, ingen tastetryk og ingen sporing af,
                    hvad du laver på computeren.{" "}
                    <Link href="/tillid#overvaagning" className={mk.link}>
                      Sådan registrerer TimeTrack
                    </Link>
                  </span>
                </li>
                <li className="border-b border-tt-streg pb-4">
                  <span className="block font-semibold text-tt-blaek">
                    Database og backup i EU
                  </span>
                  <span className="text-[15px] text-tt-graa">
                    Hos Hetzner i Tyskland og Finland. Databehandleraftalen
                    gælder for alle planer.{" "}
                    <Link href="/databehandleraftale" className={mk.link}>
                      Læs databehandleraftalen
                    </Link>
                  </span>
                </li>
                <li className="border-b border-tt-streg pb-4">
                  <span className="block font-semibold text-tt-blaek">
                    Et rigtigt firma
                  </span>
                  <span className="text-[15px] text-tt-graa">
                    CVR 39413892. Se hvem der står bag, og hvad der sker med
                    dine data, hvis TimeTrack stopper.{" "}
                    <Link href="/tillid#kontinuitet" className={mk.link}>
                      Tillid og data
                    </Link>
                  </span>
                </li>
                <li className="border-b border-tt-streg pb-4">
                  <span className="block font-semibold text-tt-blaek">
                    Skriv direkte fra appen
                  </span>
                  <span className="text-[15px] text-tt-graa">
                    Knappen nederst til højre i appen tager imod idéer, fejl og
                    skærmbilleder. Jeg læser det hele, og nogle af dem lander i{" "}
                    <Link href="/changelog" className={mk.link}>
                      changelog
                    </Link>
                    .
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Spørgsmål og svar (FAQ-skemaet bruges af søgemaskiner) */}
        <section
          aria-labelledby="faq-heading"
          className="border-t border-tt-streg bg-tt-flade-varm py-20 sm:py-24"
        >
          <div className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr]`}>
            <div>
              <h2 id="faq-heading" className={mk.h2}>
                Spørgsmål og svar
              </h2>
              <p className={`${mk.body} mt-4`}>
                Finder du ikke svaret?{" "}
                <a href={`mailto:${brand.contactEmail}`} className={mk.link}>
                  Skriv til mig
                </a>
                , så svarer jeg på dansk.
              </p>
            </div>
            <div className="divide-y divide-tt-streg border-y border-tt-streg">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-6 font-semibold text-tt-blaek [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span
                      aria-hidden="true"
                      className="text-xl font-normal text-tt-graa transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className={`${mk.body} mt-3 max-w-2xl`}>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Afslutning */}
        <section className="py-20 sm:py-28">
          <div className={mk.wrap}>
            <h2 className={`${mk.h2} max-w-3xl`}>
              Prøv TimeTrack i {TRIAL_DAYS} dage, uden betalingskort
            </h2>
            <p className={`${mk.body} mt-4 max-w-2xl`}>
              {AFTER_TRIAL_SOLO_SHORT} {FREE_LIMITS}
            </p>
            <HeroCta location="home_bottom" showTimerLink={false} />
            <p className={`${mk.fine} mt-10`}>
              Gratis værktøjer:{" "}
              {TOOLS.map((tool, i) => (
                <span key={tool.href}>
                  <Link href={tool.href} className={mk.link}>
                    {tool.label}
                  </Link>
                  {i < TOOLS.length - 1 ? ", " : ""}
                </span>
              ))}
            </p>
            <LatestPosts />
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
