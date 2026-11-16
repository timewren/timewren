import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";

// Opgjort ud fra den faktiske drift (prod-server, Dokploy, prod-env og kode).
// Kilder og åbne punkter står i PR'en til issue #682. Ændres driften — ny
// udbyder, ny region, ny backup — skal siden opdateres samtidig.
const LAST_UPDATED = "23. oktober 2026";
const CONTACT_EMAIL = "timetrack@timetrack.dk";

const TITLE = "Tillid og data: hvor ligger dine data?";
const DESCRIPTION =
  "Hvor TimeTrack hoster dine data, hvilke databehandlere TimeTrack bruger og i hvilket land, at TimeTrack ikke tager skærmbilleder eller overvåger, at fakturerede timer låses, samt kryptering, backup, sletning, eksport, databehandleraftale og hvad der sker, hvis TimeTrack lukker.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/tillid" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/tillid",
    type: "website",
    locale: "da_DK",
    siteName: "TimeTrack",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

type Processor = {
  name: string;
  purpose: string;
  location: string;
  basis: string;
  outsideEu: boolean;
};

const CORE_PROCESSORS: Processor[] = [
  {
    name: "Hetzner Online GmbH (Tyskland)",
    purpose:
      "Server, database, filer og backup. Også TimeTracks egen mailserver og statistikserver.",
    location: "Tyskland (Nürnberg) og Finland (Helsinki)",
    basis: "EU, intet tredjelandsgrundlag nødvendigt",
    outsideEu: false,
  },
  {
    name: "Alunta (Danmark)",
    purpose: "Abonnementer og betaling af planer.",
    location: "Danmark og Tyskland",
    basis: "EU, intet tredjelandsgrundlag nødvendigt",
    outsideEu: false,
  },
  {
    name: "Resend, Inc. (USA)",
    purpose:
      "Sender og modtager e-mails fra TimeTrack, fx login-links, notifikationer og påmindelser.",
    location:
      "Mails sendes og modtages via Resends EU-region i Irland. Virksomheden er amerikansk.",
    basis: "EU-U.S. Data Privacy Framework",
    outsideEu: true,
  },
  {
    name: "Functional Software, Inc. / Sentry (USA)",
    purpose:
      "Fejlrapporter, så fejl kan rettes. En rapport kan indeholde bruger-id og teknisk kontekst.",
    location: "USA",
    basis: "EU-U.S. Data Privacy Framework",
    outsideEu: true,
  },
  {
    name: "Discord Inc. (USA)",
    purpose:
      "Interne driftsbeskeder til mig, fx navn og e-mail når en ny bruger opretter sig.",
    location: "USA",
    basis: "EU-U.S. Data Privacy Framework og EU's standardkontrakter",
    outsideEu: true,
  },
  {
    name: "Google (USA)",
    purpose:
      "Måling af TimeTracks annoncer (Google Ads) på timetrack.dk og i appen. Uden dit ja til marketing sætter tagget ingen cookies og sender kun cookieløse målinger.",
    location: "USA og EU",
    basis: "EU-U.S. Data Privacy Framework",
    outsideEu: true,
  },
  {
    name: "Cloudflare, Inc. (USA)",
    purpose:
      "DNS for timetrack.dk og netværksbeskyttelse foran statistikserveren. Selve TimeTrack går ikke gennem Cloudflare.",
    location: "Globalt netværk",
    basis: "EU-U.S. Data Privacy Framework",
    outsideEu: true,
  },
];

const OPTIONAL_PROCESSORS: Processor[] = [
  {
    name: "Billy, Dinero, e-conomic",
    purpose: "Bogføring og fakturering, når du forbinder dit regnskab.",
    location: "Danmark / EU",
    basis: "Din egen aftale med regnskabsprogrammet",
    outsideEu: false,
  },
  {
    name: "Ordbogen A/S (Danmark)",
    purpose:
      "AI-funktioner, hvis du vælger OdinCore (Ordbogen) og indsætter din egen nøgle.",
    location: "Danmark",
    basis: "Din egen aftale med Ordbogen",
    outsideEu: false,
  },
  {
    name: "OpenAI, Anthropic eller andet AI-endpoint",
    purpose:
      "AI-funktioner, hvis du selv indsætter en nøgle til en af disse udbydere.",
    location: "Typisk USA",
    basis: "Din egen aftale med udbyderen",
    outsideEu: true,
  },
  {
    name: "Google, Apple, GitHub, Discord",
    purpose:
      "Login, hvis du vælger at logge ind med en af dem. Google også til kalendersynkronisering, hvis du forbinder den.",
    location: "USA",
    basis: "EU-U.S. Data Privacy Framework",
    outsideEu: true,
  },
  {
    name: "650 Industries, Inc. / Expo (USA)",
    purpose:
      "Push-notifikationer til mobilappen (i beta), hvis du slår dem til.",
    location: "USA",
    basis: "EU-U.S. Data Privacy Framework",
    outsideEu: true,
  },
  {
    name: "Stripe",
    purpose: "Betaling, kun hvis du køber en livstidslicens til desktop-appen.",
    location: "Stripe Payments Europe (Irland), med behandling i USA",
    basis: "EU-U.S. Data Privacy Framework",
    outsideEu: true,
  },
  {
    name: "Apple (App Store)",
    purpose:
      "Betaling, kun hvis du køber abonnementet i iPhone-appen. Apple sælger abonnementet og håndterer betalingen. TimeTrack modtager købets id, produkt og status, aldrig dine betalingsoplysninger.",
    location: "Apple Distribution International (Irland), med behandling i USA",
    basis: "Din egen aftale med Apple (App Store-vilkårene)",
    outsideEu: true,
  },
  {
    name: "Google (Google Play)",
    purpose:
      "Betaling, kun hvis du køber abonnementet i Android-appen. Google sælger abonnementet og håndterer betalingen. TimeTrack modtager købets id, produkt og status, aldrig dine betalingsoplysninger.",
    location: "Google Commerce Limited (Irland), med behandling i USA",
    basis: "Din egen aftale med Google (Google Play-vilkårene)",
    outsideEu: true,
  },
];

function ProcessorList({ items }: { items: Processor[] }) {
  return (
    <ul className="mt-6 divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200">
      {items.map((p) => (
        <li
          key={p.name}
          className="grid gap-3 bg-white p-5 sm:grid-cols-[1.1fr_1.4fr_1fr] sm:gap-6"
        >
          <div>
            <p className="font-semibold text-gray-900">{p.name}</p>
            <p className="mt-1">
              <span
                className={
                  p.outsideEu
                    ? "inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-200"
                    : "inline-flex rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800 ring-1 ring-green-200"
                }
              >
                {p.outsideEu ? "Uden for EU" : "EU"}
              </span>
            </p>
          </div>
          <p className="text-sm leading-relaxed text-gray-700">{p.purpose}</p>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-gray-500">Hvor</dt>
              <dd className="text-gray-900">{p.location}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Grundlag</dt>
              <dd className="text-gray-900">{p.basis}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-gray-200 pt-12">
      <h2 className="text-2xl font-semibold tracking-tight text-gray-900">
        {title}
      </h2>
      <div className="mt-4 space-y-4 leading-relaxed text-gray-700">
        {children}
      </div>
    </section>
  );
}

export default function TillidPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <MarketingHero
        align="left"
        title="Hvor ligger dine data?"
        subtitle="TimeTrack er udviklet og drevet fra Danmark. Her kan du se, hvor dine data ligger, hvem der behandler dem, og hvordan de bliver passet på. Siden er opgjort ud fra den faktiske drift."
      >
        <p className="mt-6 text-sm text-gray-500">
          Sidst opdateret: {LAST_UPDATED}
        </p>
      </MarketingHero>

      <main className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-12">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
              <p className="text-sm font-semibold text-gray-900">
                Database, filer og backup
              </p>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">
                Ligger i EU hos Hetzner, i Tyskland og Finland.
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
              <p className="text-sm font-semibold text-gray-900">
                Nogle underleverandører er amerikanske
              </p>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">
                Mail, fejlrapporter, annoncemåling og interne driftsbeskeder. De
                står alle nedenfor, med land og grundlag.
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
              <p className="text-sm font-semibold text-gray-900">
                Dine data er dine
              </p>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">
                Du kan eksportere dine data og slette din konto selv. TimeTrack
                sælger aldrig data.
              </p>
            </div>
          </div>

          <Section
            id="overvaagning"
            title="Ingen skærmbilleder og ingen overvågning"
          >
            <p>
              TimeTrack registrerer den tid, du selv starter eller skriver ind,
              ikke hvad du laver på computeren.
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                Ingen af TimeTracks apps tager skærmbilleder eller optager
                skærmen. Det eneste skærmbillede, TimeTrack modtager, er et, du
                selv vælger at vedhæfte til en feedback-besked.
              </li>
              <li>TimeTrack registrerer ikke tastetryk eller museklik.</li>
              <li>
                Desktop-appen fører en aktivitetslog over, hvilket program og
                vindue der er aktivt, så du bagefter kan se, hvad du arbejdede
                på. Loggen ligger kun på din egen computer og sendes ikke til
                TimeTrack. Adressen på hjemmesider i browseren kommer kun med,
                hvis du selv slår det til. Bruger du AI-forslag med din egen
                nøgle, sendes korte uddrag til den AI-udbyder, du har valgt.
              </li>
              <li>
                Browserudvidelsen bruger sidens titel og adresse til at foreslå
                et projekt, men sender dem ikke til TimeTrack.
              </li>
              <li>
                Desktop-appen og browserudvidelsen opdager, når du har været væk
                fra computeren, så de kan spørge, om tiden skal tælle med.
              </li>
              <li>
                Browserudvidelsen beder derfor om browserens{" "}
                <code className="rounded bg-gray-100 px-1 text-sm">idle</code>
                -tilladelse. Den fortæller kun, om computeren er i brug, ikke i
                brug eller låst, aldrig hvad du laver. Kun mens en timer kører,
                og du har været væk længere end din grænse (som standard 5
                minutter), gemmes tidspunktet, hvor du gik fra, på timeren. Når
                du kommer tilbage, bliver du spurgt, om tiden skal tælle med, og
                tidspunktet slettes igen. Er du væk i lang tid (som standard 2
                timer), sættes timeren på pause. Tidspunktet vises ikke for din
                leder.
              </li>
              <li>
                I et team ser lederen de timer, det fravær og de check ind, som
                medarbejderne selv registrerer. Lederen kan ikke se, hvilke
                programmer eller hjemmesider de har brugt.
              </li>
            </ul>
          </Section>

          <Section id="faktureret" title="Fakturerede timer låses">
            <p>
              Når en tidspost står på en faktura, eller du har markeret den som
              faktureret, kan den ikke ændres eller slettes, hverken på web, i
              apps, i browserudvidelsen, i desktop-appen eller via API'et. Så
              stemmer fakturaen og registreringen altid overens. Den interne
              note på posten kan stadig rettes, fordi den ikke står på
              fakturaen.
            </p>
            <p>
              Skal en faktureret post rettes, krediterer du fakturaen og
              frigiver timerne, eller fjerner posten fra fakturakladden. Har du
              selv markeret posten som faktureret, fjerner du markeringen.
            </p>
          </Section>

          <Section id="support" title="Support på dansk">
            <p>
              Du får support på dansk. Skriv til{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>

          <Section id="hosting" title="Hosting">
            <p>
              TimeTrack kører på en dedikeret cloud-server hos Hetzner Online
              GmbH i datacentret i Nürnberg, Tyskland. Databasen (PostgreSQL) og
              cachen kører på samme server og kan ikke nås direkte fra
              internettet. Login på serveren kræver en SSH-nøgle.
            </p>
            <p>
              Filer, du uploader, fx vedhæftninger, ligger i Hetzners
              objektlager i Helsinki, Finland. Det gør backuppen også.
            </p>
            <p>
              TimeTracks egen mailserver, der tager imod mails til
              @timetrack.dk, og den cookieløse statistik (Plausible, som jeg
              selv driver) kører også på Hetzner-servere i Helsinki.
            </p>
          </Section>

          <Section id="databehandlere" title="Databehandlere">
            <p>
              Det her er de virksomheder, der behandler data for TimeTrack. Står
              der »Uden for EU«, sker overførslen på det grundlag, der er
              angivet.
            </p>

            <h3 className="pt-4 text-lg font-semibold text-gray-900">
              Altid i brug
            </h3>
            <ProcessorList items={CORE_PROCESSORS} />

            <h3 className="pt-8 text-lg font-semibold text-gray-900">
              Kun hvis du selv slår det til
            </h3>
            <ProcessorList items={OPTIONAL_PROCESSORS} />

            <p className="pt-4">
              TimeTrack har ingen fælles AI-nøgle slået til. AI-funktioner
              sender kun data, hvis du selv indsætter en nøgle under
              Indstillinger, og så går de til den udbyder, du har valgt. Vil du
              holde data i Danmark, kan du vælge OdinCore (Ordbogen).
            </p>
            <p>
              Du kan logge ind med e-mail og adgangskode, magisk link eller
              passkey. Det kræver ingen amerikansk udbyder.
            </p>
          </Section>

          <Section id="eu-plan" title="Planen for udbydere uden for EU">
            <p>
              Jeg vil gerne have så meget som muligt i EU. Det er planen for de
              amerikanske udbydere, jeg selv har valgt:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Sentry:</strong> Sentry tilbyder datalagring i EU
                (Tyskland). Planen er at flytte fejlrapporteringen dertil.
              </li>
              <li>
                <strong>Discord:</strong> De interne driftsbeskeder skal ikke
                længere indeholde navn og e-mail. Personoplysningerne sendes kun
                på mail fra TimeTracks egen server.
              </li>
              <li>
                <strong>Resend:</strong> Mails sendes allerede fra Resends
                EU-region. Jeg undersøger en europæisk afsender.
              </li>
              <li>
                <strong>Stripe:</strong> Bruges kun til livstidslicensen til
                desktop-appen. Abonnementer købt på web går gennem danske
                Alunta.
              </li>
            </ul>
            <p>
              Når en udbyder skiftes, opdaterer jeg denne side og skriver det i
              nyhederne i TimeTrack.
            </p>
          </Section>

          <Section id="kryptering" title="Kryptering og adgang">
            <ul className="list-disc space-y-2 pl-6">
              <li>
                Al trafik til TimeTrack går over HTTPS. Gamle versioner af TLS
                (1.0 og 1.1) afvises, og browseren får besked om altid at bruge
                HTTPS (HSTS).
              </li>
              <li>
                Adgangskoder gemmes aldrig i klartekst, kun som en envejs-hash.
              </li>
              <li>
                Adgangstokens, API-nøgler og adgangskoder til integrationer
                (Google Calendar, iCloud-kalender, Billy, Dinero, e-conomic,
                TimeOps-import, IMAP-mail og din egen OpenAI-nøgle) gemmes
                krypteret i databasen med AES-256-GCM. Nøglen ligger ikke i
                databasen.
              </li>
              <li>
                Du kan slå totrinsbekræftelse og passkeys til på din konto.
              </li>
              <li>
                Data er adskilt pr. organisation, og hver forespørgsel tjekkes
                på serveren.
              </li>
              <li>
                Serverens disk er ikke krypteret for sig. Beskyttelsen ligger i,
                at databasen ikke kan nås udefra, og at adgangen til serveren er
                begrænset.
              </li>
            </ul>
          </Section>

          <Section id="backup" title="Backup">
            <ul className="list-disc space-y-2 pl-6">
              <li>
                Den daglige databasedump krypteres på serveren med age, før den
                uploades til Hetzner Object Storage i Helsinki, altså et andet
                sted end serveren i Nürnberg. Serveren har kun den offentlige
                nøgle; den private nøgle opbevares separat. Opbevaring 30 dage.
              </li>
              <li>
                Dumps fra før 11. oktober 2026 er ikke krypteret på den måde.
                Der laves ikke flere af dem, men de ligger stadig i
                objektlageret, indtil de er slettet.
              </li>
              <li>
                Derudover er der en libsodium-krypteret løbende backup (PITR),
                så databasen kan gendannes til et bestemt tidspunkt. Den gemmes
                i 14 dage.
              </li>
              <li>
                Hetzner tager også en daglig backup af hele serveren og gemmer
                de seneste 7.
              </li>
              <li>
                Filer, du uploader, fx vedhæftninger og logoer, er ikke
                krypteret for sig i objektlageret.
              </li>
              <li>
                Den løbende backup gendannes automatisk hver måned på en adskilt
                kopi, hvor tabeller og antal rækker sammenlignes med den rigtige
                database. For den krypterede daglige dump tjekkes hver måned, at
                den findes, er ny og er krypteret. En fuld gendannelse af den
                sker manuelt, fordi den private nøgle ikke ligger på serveren.
                Seneste automatiske test: 3. oktober 2026.
              </li>
            </ul>
          </Section>

          <Section id="sletning" title="Sletning">
            <p>
              Du kan selv slette din konto under Indstillinger. Dine data i
              databasen slettes med det samme, og et aktivt abonnement købt på
              timetrack.dk annulleres. Et abonnement købt i App Store eller
              Google Play stopper ikke af sig selv og skal opsiges i butikken.
              Det skal du bekræfte, før kontoen slettes. Er du medlem af et
              team, bliver det, du har registreret i teamet, fx tid og
              fakturaer, stående hos teamet, fordi virksomheden ejer de data.
              Dit navn, din e-mail og dit billede fjernes, så der kun står
              &quot;Slettet bruger&quot;. Er du eneste ejer af et team med andre
              medlemmer, skal du først overdrage ejerskabet til et andet medlem.
            </p>
            <p>
              Virksomheder, der bruger fravær og timesedler, har en
              hændelseslog, som dokumenterer registreringerne efter reglerne om
              arbejdstid. Når en bruger slettes, bliver navnet i loggen
              anonymiseret.
            </p>
            <p>
              Slettede data forsvinder fra backuppen, når den sidste backup med
              dem er udløbet, dvs. senest efter 30 dage. Undtagelsen er de
              ældre, ukrypterede dumps fra før 11. oktober 2026, indtil de er
              slettet.
            </p>
          </Section>

          <Section id="eksport" title="Eksport">
            <p>Det her kan du selv hente ud, uden at skrive til nogen:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Alle organisationens data som én fil</strong> for ejere
                og administratorer under Indstillinger → Import og eksport.
                Bruger du TimeTrack alene, er du ejer. Filen er en ZIP med alle
                data som JSON, en CSV-fil pr. tabel, de vedhæftede filer og en
                README, der forklarer indholdet. Den indeholder
                tidsregistreringer for alle brugere, kunder, projekter, opgaver,
                klippekort og forbrug, fakturaer og fakturagrundlag, fravær,
                timesedler med godkendelseshistorik, hændelsesloggen,
                indstillinger og vedhæftede filer.
              </li>
              <li>
                Eksporten kræver ikke et betalt abonnement. TimeTrack bygger
                filen i baggrunden og sender dig en mail med et link, der virker
                i 7 dage. Derefter slettes filen. Adgangsnøgler og adgangskoder
                er ikke med.
              </li>
              <li>
                <strong>Dine egne data, uanset rolle</strong> under
                Indstillinger → Import og eksport (kortet &quot;Hent dine egne
                data&quot;) eller under Indstillinger → GDPR. Også du som
                medarbejder kan hente det, der er gemt om dig, i den
                organisation du er i: dine tidsregistreringer og timere, dit
                fravær og din ferie, dine timesedler med godkendelseshistorik,
                opgaver du har oprettet eller fået tildelt, dine kommentarer,
                din profil og dine indstillinger. Kollegers data, kundernes
                oplysninger, fakturaer og organisationens opsætning er ikke med,
                og timepriser, beløb og kostpriser er kun med for ejere og
                administratorer. Filen dækker kun den organisation, du er i,
                fordi hver organisation er dataansvarlig for sig. Er du med i
                flere organisationer, bestiller du en fil i hver. Filen er en
                ZIP som den fulde eksport, kræver ikke et betalt abonnement, og
                linket virker i 7 dage og kun for dig.
              </li>
              <li>
                <strong>En kortere fil som JSON eller CSV</strong> under
                Indstillinger → GDPR, for ejere og administratorer (bruger du
                TimeTrack alene, er du ejer): profil, firmaoplysninger, kunder,
                projekter, tidsregistreringer, opgaver, fakturaer med linjer,
                klippekort med forbrug, timeprishistorik, timerskabeloner og
                dine indstillinger for mails og notifikationer.
              </li>
              <li>
                <strong>Virksomheder med fravær og timesedler</strong> kan
                desuden hente rapporter over løn, sygdom, fravær, flex og
                overtid, ferie, projekter og arbejdstid som CSV, Excel eller
                PDF, og hver medarbejder kan hente sine egne registreringer.
              </li>
              <li>
                Timer og rapporter kan også hentes som CSV og PDF, og timer kan
                sendes videre til Billy og Dinero.
              </li>
            </ul>
          </Section>

          <Section id="dpa" title="Databehandleraftale">
            <p>
              Bruger du TimeTrack til data om andre, fx medarbejdere eller
              kunder, er TimeTrack din databehandler. Databehandleraftalen
              gælder for alle planer, også Gratis, og du kan læse den her:{" "}
              <Link
                href="/databehandleraftale"
                className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
              >
                Databehandleraftale
              </Link>
              . Du kan hente den som PDF, og er du ejer eller administrator, kan
              du hente den udfyldt med jeres navn og CVR og acceptere den
              elektronisk under Indstillinger &gt; GDPR &amp; Databeskyttelse.
              Vil du hellere have en fysisk underskrevet kopi, så skriv til mig
              på{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>

          <Section id="kontinuitet" title="Hvad hvis Mads stopper?">
            <p>
              TimeTrack er lavet og drevet af mig, Mads Holst Jensen. Det er et
              rimeligt spørgsmål, hvad der sker med dine data, hvis jeg en dag
              lukker TimeTrack. Her er det, jeg kan love i dag:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Varsel på mail:</strong> Lukker TimeTrack, får du besked
                på mail mindst 6 måneder før.
              </li>
              <li>
                <strong>Dine data kan hentes ud:</strong> Hele perioden kan du
                selv hente alle dine data som én fil, også vedhæftede filer,
                hændelsesloggen og godkendelseshistorikken, som beskrevet under{" "}
                <a
                  href="#eksport"
                  className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
                >
                  Eksport
                </a>
                .
              </li>
              <li>
                <strong>Penge tilbage:</strong> Har du betalt forud for en
                periode, du ikke når at bruge, får du den ubrugte del tilbage.
              </li>
              <li>
                <strong>Sletning:</strong> Når TimeTrack lukker, slettes dine
                data efter databehandleraftalen, også i backuppen.
              </li>
            </ul>
            <p>
              Det står også i{" "}
              <Link
                href="/terms#lukning"
                className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
              >
                vilkårene
              </Link>
              .
            </p>
          </Section>

          <Section id="mere" title="Læs mere">
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <Link
                  href="/privacy"
                  className="text-brand-700 underline underline-offset-2 hover:text-brand-800"
                >
                  Privatlivspolitik
                </Link>
              </li>
              <li>
                <Link
                  href="/gdpr"
                  className="text-brand-700 underline underline-offset-2 hover:text-brand-800"
                >
                  Dine rettigheder efter GDPR
                </Link>
              </li>
              <li>
                <Link
                  href="/cookies"
                  className="text-brand-700 underline underline-offset-2 hover:text-brand-800"
                >
                  Cookies
                </Link>{" "}
                og samtykke til marketing
              </li>
              <li>
                <Link
                  href="/security-policy"
                  className="text-brand-700 underline underline-offset-2 hover:text-brand-800"
                >
                  Sådan melder du et sikkerhedshul
                </Link>
              </li>
            </ul>
            <p>
              Har du spørgsmål, så skriv til{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </Section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
