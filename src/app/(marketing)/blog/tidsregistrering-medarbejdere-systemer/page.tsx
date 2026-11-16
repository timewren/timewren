import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
} from "@/lib/billing/plan-gate";
import {
  appLinkHref,
  BUSINESS_INCLUDED_SEATS,
  BUSINESS_SEAT_PRICE_MONTHLY,
  FREE_TRIAL_DAYS,
  TEAM_INCLUDED_SEATS,
  TEAM_SEAT_PRICE_MONTHLY,
} from "@/lib/config";

const TITLE =
  "Tidsregistrering af medarbejdere: 8 systemer og priser sammenlignet (2026)";
const DESCRIPTION =
  "Hvad koster tidsregistrering af medarbejdere? Vi har sammenlignet SmartTID, Danløn, DataLøn, Intempus, TimeLog, BitaBIZ, Timegrip og TimeTrack på pris, opstartsgebyr og funktioner til arbejdstidsloven.";
const PATH = "/blog/tidsregistrering-medarbejdere-systemer";

export const metadata: Metadata = {
  // Kortere end overskriften, så Google ikke klipper titlen i søgeresultatet.
  title: { absolute: "Tidsregistrering af medarbejdere: 8 systemer og priser" },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  alternates: { canonical: PATH },
};

type Row = {
  name: string;
  url: string;
  price: string;
  setup: string;
  trial: string;
};

// Priser hentet 11/10-2026 fra leverandørernes egne prissider. Opdatér
// dateModified og teksten "Priserne er hentet …" når tabellen ændres.
const ROWS: Row[] = [
  {
    name: "SmartTID",
    url: "https://smarttid.dk/pris/",
    price: "59 eller 69 kr. pr. medarbejder/md. ekskl. moms + superbruger",
    setup: "Startpakke fra 3.295 kr., min. 5 medarbejdere",
    trial: "30 dage",
  },
  {
    name: "Danløn",
    url: "https://www.danlon.dk/priser/",
    price: "Gratis app til tid og fravær",
    setup: "Timerne overføres til Danløn-lønnen",
    trial: "Appen er gratis",
  },
  {
    name: "DataLøn Tid",
    url: "https://www.dataloen.dk/prisliste/",
    price: "65, 112 eller 139 kr. pr. bruger/md. ekskl. moms",
    setup: "Opsætning fra 4.419 kr. + kursus 4.532 kr.",
    trial: "14 dage for DataLøn-kunder",
  },
  {
    name: "Intempus",
    url: "https://www.intempus.dk/priser/",
    price: "65, 112 eller 139 kr. pr. bruger/md.",
    setup: "Oprettelse fra 4.900 kr., integrationer fra 4.000 kr.",
    trial: "14 dage",
  },
  {
    name: "TimeLog",
    url: "https://www.timelog.com/da/priser/",
    price: "109, 259 eller 399 kr. pr. bruger/md.",
    setup: "Ikke oplyst",
    trial: "14 dage",
  },
  {
    name: "BitaBIZ",
    url: "https://www.bitabiz.dk/en/price/",
    price: "20,51 eller 26,53 kr. pr. bruger/md. + tilkøb",
    setup: "Gratis opsætning",
    trial: "30 dage",
  },
  {
    name: "Timegrip",
    url: "https://timegrip.dk/priser/",
    price: "Fra 1.600 kr./md. for 20 medarbejdere",
    setup: "Ikke oplyst",
    trial: "Ja, længde ikke oplyst",
  },
  {
    name: "TimeTrack",
    url: "/pricing",
    price: `${TEAM_SEAT_PRICE_MONTHLY} eller ${BUSINESS_SEAT_PRICE_MONTHLY} kr. pr. bruger/md. ekskl. moms`,
    setup: "Intet oprettelsesgebyr",
    trial: `30 dage, gratis plan: ${FREE_MAX_SEATS} brugere, ${FREE_MAX_ACTIVE_CLIENTS} kunder`,
  },
];

export default function TidsregistreringMedarbejdereSystemerPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: TITLE,
    description: DESCRIPTION,
    author: { "@type": "Person", name: "Mads Holst Jensen" },
    publisher: {
      "@type": "Organization",
      name: "TimeTrack",
      url: "https://timetrack.dk",
    },
    datePublished: "2026-10-11",
    dateModified: "2026-10-11",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `https://timetrack.dk${PATH}`,
    },
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: statisk JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <Navigation />

      <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <header>
          <Link
            href="/blog"
            className="text-sm text-brand-600 hover:text-brand-700"
          >
            ← Tilbage til blog
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Tidsregistrering af medarbejdere: 8 systemer og priser sammenlignet
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Siden 1. juli 2024 skal danske arbejdsgivere registrere
            medarbejdernes daglige arbejdstid. Der findes mange systemer, og
            priserne er svære at sammenligne. Her er de mest brugte, med pris,
            opstartsgebyr og hvem de passer til.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-500">
            <span>Af Mads Holst Jensen</span>
            <span>11. oktober 2026</span>
            <span>8 min læsetid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-slate-700 leading-relaxed">
          <p>
            Jeg laver selv TimeTrack, som er med i sammenligningen. Derfor har
            jeg kun brugt tal, der står på leverandørernes egne prissider, og
            jeg skriver det også, når et andet system passer bedre til jer.
            Priserne er hentet 11. oktober 2026. Tjek altid den aktuelle pris
            hos leverandøren.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvad skal systemet kunne?
          </h2>
          <p>
            Loven kræver, at den daglige arbejdstid registreres i et objektivt,
            pålideligt og tilgængeligt system. Læs detaljerne om{" "}
            <Link
              href="/tidsregistrering-lovkrav"
              className="text-brand-600 underline hover:text-brand-700"
            >
              lovkravet om tidsregistrering
            </Link>
            . I praksis bør I kigge efter:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Daglig registrering</strong>, enten som check ind/ud eller
              som timer pr. dag.
            </li>
            <li>
              <strong>Ferie, fravær og flex</strong>, så saldi ikke lever i et
              regneark ved siden af.
            </li>
            <li>
              <strong>Godkendelse</strong>, så en leder kan godkende tid og
              fravær, og så der er dokumentation bagefter.
            </li>
            <li>
              <strong>App eller browser</strong>, så medarbejderne kan
              registrere, hvor de arbejder.
            </li>
            <li>
              <strong>Eksport til løn eller regnskab</strong>, så timerne ikke
              skal tastes ind igen.
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            Priserne side om side
          </h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-900">
                <tr>
                  <th className="px-4 py-3 font-semibold">System</th>
                  <th className="px-4 py-3 font-semibold">Pris</th>
                  <th className="px-4 py-3 font-semibold">Opstart</th>
                  <th className="px-4 py-3 font-semibold">Prøve</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {ROWS.map((row) => (
                  <tr key={row.name}>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {row.url.startsWith("/") ? (
                        <Link href={row.url} className="text-brand-600">
                          {row.name}
                        </Link>
                      ) : (
                        <a
                          href={row.url}
                          rel="nofollow noopener"
                          target="_blank"
                          className="text-brand-600"
                        >
                          {row.name}
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3">{row.price}</td>
                    <td className="px-4 py-3">{row.setup}</td>
                    <td className="px-4 py-3">{row.trial}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-slate-500">
            Flere leverandører har pakker med forskelligt indhold. Den laveste
            pris dækker ikke altid ferie, overtid eller godkendelser.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Systemerne kort fortalt
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">SmartTID</h3>
          <p>
            Bygget til virksomheder med folk på gulvet: produktion, lager,
            transport og service. Medarbejderne stempler ind på en terminal på
            væggen eller i appen, og der er overenskomstfortolkning og
            integration til lønsystemer. Der betales for mindst 5 medarbejdere
            plus en superbruger, og der er en obligatorisk startpakke.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">Danløn</h3>
          <p>
            Kører I allerede løn i Danløn, er medarbejderappen til tid og fravær
            gratis, og timerne for timelønnede overføres direkte til lønnen. Det
            er det billigste valg, hvis Danløn i forvejen er jeres lønsystem,
            men det er ikke et system til projekter eller fakturering.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            DataLøn Tid og Intempus
          </h3>
          <p>
            De to har samme tre pakker til 65, 112 og 139 kr. pr. bruger. Basis
            dækker tid, fravær, stempelur og kørsel. Standard tilføjer
            projekter, materialer, overtid, afspadsering og godkendelser. De er
            stærke til timelønnede med overenskomst, håndværkere og
            vikarbureauer. Til gengæld er der et opsætningsgebyr på flere
            tusinde kroner, før man går i gang.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">TimeLog</h3>
          <p>
            TimeLog er et projektstyrings- og økonomisystem til konsulenthuse,
            hvor tidsregistrering er én del af mange. Det er et godt valg til
            store projektorganisationer, men prisen stiger hurtigt: Integration
            til løn kræver Growth til 259 kr. pr. bruger.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">BitaBIZ</h3>
          <p>
            Det billigste af de betalte systemer pr. bruger, med fokus på
            fravær, ferie, flex og arbejdstid. Flere ting som SSO og regler for
            EU&apos;s arbejdstidsdirektiv er tilkøb. Skal I kun dokumentere
            arbejdstid og fravær og ikke registrere tid på kunder eller
            projekter, er det svært at slå på pris.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">Timegrip</h3>
          <p>
            Vagtplanlægning og stempelur i ét, til vagtbaserede brancher som
            detail, hotel og sundhed. Prisen starter ved 1.600 kr. om måneden
            for 20 medarbejdere.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">TimeTrack</h3>
          <p>
            TimeTrack er bygget til teams, der registrerer tid på kunder og
            projekter og vil fakturere ud fra timerne. Team koster{" "}
            {TEAM_SEAT_PRICE_MONTHLY} kr. pr. bruger (min. {TEAM_INCLUDED_SEATS}{" "}
            brugere) med fælles kunder, projekter og klippekort. Virksomhed
            koster {BUSINESS_SEAT_PRICE_MONTHLY} kr. pr. bruger (min.{" "}
            {BUSINESS_INCLUDED_SEATS} brugere) og lægger check ind/ud, ferie,
            fravær, flex, godkendelser og SSO oveni. Der er intet
            oprettelsesgebyr, og timerne kan sendes til Billy, Dinero og
            e-conomic. Gratis-planen dækker {FREE_MAX_SEATS} brugere og{" "}
            {FREE_MAX_ACTIVE_CLIENTS} aktive kunder, med fakturering og
            klippekort.
          </p>
          <p>
            TimeTrack har ikke terminaler til væggen, GPS eller
            overenskomstfortolkning. Har I mange timelønnede på overenskomst,
            passer et lønnært system som SmartTID, DataLøn eller Intempus bedre.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvilket system skal I vælge?
          </h2>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>I kører løn i Danløn og vil bare opfylde loven:</strong>{" "}
              start med Danløns gratis app.
            </li>
            <li>
              <strong>Timelønnede, overenskomst, terminal eller kørsel:</strong>{" "}
              SmartTID, DataLøn Tid eller Intempus.
            </li>
            <li>
              <strong>Kun arbejdstid og fravær, lavest mulig pris:</strong>{" "}
              BitaBIZ.
            </li>
            <li>
              <strong>Vagtplan og stempelur:</strong> Timegrip.
            </li>
            <li>
              <strong>
                Tid på kunder og projekter, fakturering og arbejdstid i ét:
              </strong>{" "}
              TimeTrack, eller TimeLog hvis I er en stor projektorganisation.
            </li>
          </ul>
          <p>
            Vil I se, hvad TimeTrack koster for jeres antal medarbejdere, så
            brug{" "}
            <Link
              href="/team-prisberegner"
              className="text-brand-600 underline hover:text-brand-700"
            >
              team-prisberegneren
            </Link>
            .
          </p>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-slate-50 p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            Prøv TimeTrack med hele teamet
          </h2>
          <p className="mt-2 text-slate-600">
            {FREE_TRIAL_DAYS} dage med alle funktioner, intet betalingskort og
            intet oprettelsesgebyr.
          </p>
          <Link
            href={appLinkHref("/register?plan=business")}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white hover:bg-brand-700"
          >
            Start gratis
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </article>

      <Footer />
    </div>
  );
}
