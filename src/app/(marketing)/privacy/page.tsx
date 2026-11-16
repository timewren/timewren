import type { Metadata } from "next";

import Link from "next/link";
import { Footer } from "@/components/Footer";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Privatlivspolitik",
  description:
    "Privatlivspolitik for TimeTrack: hvilke data vi indsamler, hvordan de bruges, databehandlere, cookies og dine rettigheder.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <MarketingHero
        title="Privatlivspolitik"
        subtitle="Sidst opdateret: 1. oktober 2026"
      />

      {/* Content Section */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="typeset typeset-doc mx-auto max-w-4xl">
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-6">
            <p className="text-sm text-slate-700">
              TimeTrack tager din privatliv alvorligt. Denne privatlivspolitik
              beskriver, hvordan vi indsamler, bruger og beskytter dine
              personlige oplysninger.
            </p>
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            1. Hvem Er Vi?
          </h2>
          <p className="text-slate-600">
            TimeTrack drives af Mahope (Mahoje) v/ Mads Holst Jensen (CVR:
            39413892). Vi er dataansvarlig for behandlingen af dine
            personoplysninger. Bruger du TimeTrack til oplysninger om andre, fx
            medarbejdere eller dine kunder, er TimeTrack i stedet din
            databehandler efter{" "}
            <a
              href="/databehandleraftale"
              className="text-brand-600 hover:text-brand-700"
            >
              databehandleraftalen
            </a>
            .
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            2. Hvilke Data Indsamler Vi?
          </h2>
          <p className="text-slate-600">Vi indsamler følgende typer data:</p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>
              <strong>Kontooplysninger:</strong> Navn, email, virksomhedsnavn,
              telefonnummer (valgfrit)
            </li>
            <li>
              <strong>Brugsdata:</strong> Tidsposteringer, kundeoplysninger,
              projekter, fakturaer, opgaver
            </li>
            <li>
              <strong>Betalingsdata:</strong> Stripe håndterer kortoplysninger.
              Vi gemmer kun korttype og de sidste 4 cifre til visning
            </li>
            <li>
              <strong>Kontaktformular:</strong> Navn, email, besked
            </li>
            <li>
              <strong>Kalenderdata:</strong> Kalenderbegivenheder (kun hvis du
              tilslutter Google Calendar)
            </li>
            <li>
              <strong>Tekniske data:</strong> IP-adresse, browser type,
              enhedstype, fejlrapporter
            </li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            3. Hvordan Bruger Vi Dine Data?
          </h2>
          <p className="text-slate-600">Vi bruger dine data til at:</p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>Levere og vedligeholde TimeTrack-tjenesten</li>
            <li>Behandle betalinger og administrere abonnementer</li>
            <li>
              Sende dig transaktionelle emails (bekræftelser, fakturaer,
              password reset)
            </li>
            <li>Sende dig opdateringer om produktnyheder (kan fravælges)</li>
            <li>Besvare dine support-henvendelser</li>
            <li>
              Levere AI-funktioner som opgaveforslag, tidsestimering og
              kategorisering (kun hvis du aktiverer dette)
            </li>
            <li>
              Forbedre vores service baseret på anonymiseret brugsstatistik
            </li>
            <li>Overvåge og fejlrette tekniske problemer</li>
            <li>Overholde juridiske forpligtelser</li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            4. Hvem Deler Vi Data Med?
          </h2>
          <p className="text-slate-600">
            Vi deler kun dine data med tredjeparter, når det er nødvendigt for
            at levere vores service. Nedenfor finder du en komplet liste over
            alle databehandlere.
          </p>

          <h3 className="mb-3 mt-6 text-xl font-semibold text-slate-900">
            4.1 Kernetjenester (altid aktive)
          </h3>
          <ul className="mt-4 space-y-3 text-slate-600">
            <li>
              <strong>Hosting:</strong> Hetzner. Databasen ligger i Nürnberg,
              Tyskland, og filer og backup i Helsinki, Finland (begge EU).
              Enkelte underleverandører, fx til mail og fejlrapporter, er
              amerikanske; de står med land og grundlag på{" "}
              <a href="/tillid" className="text-brand-600 hover:text-brand-700">
                Tillid og data
              </a>
              .
            </li>
            <li>
              <strong>Email:</strong> Resend (GDPR-compliant): transaktionelle
              emails som password reset, fakturaer og notifikationer.
            </li>
            <li>
              <strong>Betaling:</strong> Stripe (PCI DSS Level 1-certificeret):
              behandler kortbetalinger. Vi modtager og gemmer aldrig dit fulde
              kortnummer. Stripe har indgået EU Standard Contractual Clauses.
            </li>
            <li>
              <strong>Fejlovervågning:</strong> Sentry (GDPR-compliant): vi
              bruger Sentry til at opdage og løse tekniske fejl. Data kan
              indeholde IP-adresse og browser-info, men ikke personligt
              identificerbare forretningsdata.
            </li>
            <li>
              <strong>Analytics:</strong> Plausible Analytics (selvhostet): vi
              kører vores egen instans af Plausible. Ingen cookies, ingen
              persondata, og alle data forbliver på vores egne servere i EU.
            </li>
          </ul>

          <h3 className="mb-3 mt-6 text-xl font-semibold text-slate-900">
            4.2 Valgfrie integrationer (kun aktive hvis du vælger dem)
          </h3>
          <ul className="mt-4 space-y-3 text-slate-600">
            <li>
              <strong>AI-funktioner (OpenAI):</strong> Hvis du aktiverer
              AI-funktioner (opgaveforslag, tidsestimering, kategorisering),
              sendes relevante opgavetekster og tidsdata til OpenAIs API. Du kan
              også bruge din egen API-nøgle (BYOK). Se sektion 4.3 for detaljer.
            </li>
            <li>
              <strong>Google Calendar:</strong> Hvis du tilslutter din kalender,
              henter vi kalenderbegivenheder fra de kalendere, du vælger. Som
              standard får TimeTrack kun læseadgang. Du kan frakoble når som
              helst. Se sektion 4.4 for detaljer.
            </li>
            <li>
              <strong>Bogføring:</strong> Billy, Dinero og e-conomic: kun aktive
              hvis du konfigurerer integrationen. Vi sender faktura- og
              kundedata til den valgte udbyder.
            </li>
            <li>
              <strong>SMS-login:</strong> MessageBird: kun hvis du vælger
              telefon-login. Vi sender dit telefonnummer og en engangskode via
              SMS.
            </li>
            <li>
              <strong>OAuth-login:</strong> Google, GitHub eller Discord: kun
              hvis du vælger at logge ind via disse udbydere. Vi modtager kun
              dit navn og email fra udbyderen.
            </li>
            <li>
              <strong>Notifikationer:</strong> Discord/Slack webhooks: kun
              aktive hvis du konfigurerer dem. Webhook-URL&apos;er (også
              organisationens Microsoft Teams-webhook) gemmes krypteret i
              databasen (AES-256-GCM).
            </li>
          </ul>

          <h3 className="mb-3 mt-6 text-xl font-semibold text-slate-900">
            4.3 AI-funktioner og databehandling
          </h3>
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <p className="text-sm text-slate-700">
              <strong>Vigtigt om AI:</strong> TimeTrack tilbyder valgfrie
              AI-funktioner drevet af OpenAI. Disse er{" "}
              <strong>deaktiveret som standard</strong> og kræver dit aktive
              valg.
            </p>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li>
                AI-funktioner bruges til opgaveforslag, tidsestimering,
                prioritering og kategorisering.
              </li>
              <li>
                Kun nødvendige data sendes (opgavetekster, tidsposteringer),
                aldrig adgangskoder, betalingsinfo eller personlige beskeder.
              </li>
              <li>
                Du kan bruge din egen OpenAI API-nøgle (BYOK), så data sendes
                direkte til din egen OpenAI-konto.
              </li>
              <li>
                OpenAI oplyser, at API-data ikke bruges til at træne deres
                modeller. Se{" "}
                <a
                  href="https://openai.com/enterprise-privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 hover:text-brand-700"
                >
                  OpenAIs databehandlingspolitik
                </a>
                .
              </li>
              <li>
                Du kan deaktivere AI-funktioner når som helst under
                Indstillinger.
              </li>
            </ul>
          </div>

          <h3
            id="google-brugerdata"
            className="mb-3 mt-6 text-xl font-semibold text-slate-900"
          >
            4.4 Google-brugerdata (Google Calendar)
          </h3>
          <p className="text-slate-600">
            Når du forbinder Google Calendar, får TimeTrack adgang til data fra
            din Google-konto via Googles API&apos;er. Sådan håndterer vi dem:
          </p>
          <ul className="mt-4 space-y-3 text-slate-600">
            <li>
              <strong>Hvad vi tilgår:</strong> Som standard beder vi kun om
              læseadgang til din kalender (<code>calendar.readonly</code>) og
              din Google-kontos e-mailadresse (<code>userinfo.email</code>). Vi
              læser listen over dine kalendere og begivenhederne i de kalendere,
              du vælger: titel, tidspunkt, varighed, beskrivelse, sted og din
              svarstatus. E-mailadressen bruger vi kun til at vise, hvilken
              Google-konto der er forbundet.
            </li>
            <li>
              <strong>Skriveadgang er valgfri:</strong> Kun hvis du selv slår en
              skrivende funktion til, beder vi om adgang til at oprette og ændre
              begivenheder (<code>calendar.events</code>). Den bruges
              udelukkende til at oprette, opdatere og slette de begivenheder, du
              beder TimeTrack om at lave: tidsblokke til opgaver og eksporterede
              tidsregistreringer. Vi ændrer eller sletter aldrig andre
              begivenheder i din kalender.
            </li>
            <li>
              <strong>Hvordan vi bruger dataene:</strong> Til at vise dine møder
              i TimeTrack, så du kan omdanne dem til tidsregistreringer, foreslå
              ledige tider til opgaver og give dig overblik over din arbejdsdag.
              Vi bruger ikke Google-data til reklame, sælger dem ikke og bruger
              dem ikke til at træne AI-modeller.
            </li>
            <li>
              <strong>Deling:</strong> Google-data deles ikke med andre end de
              databehandlere, der er nødvendige for at drive tjenesten (hosting
              hos Hetzner i EU). Har du selv aktiveret AI-funktioner, sendes
              titler og tidspunkter på endnu ikke registrerede begivenheder til
              OpenAIs API for at foreslå projekter og tidsregistreringer til
              dig. OpenAI bruger ikke API-data til at træne deres modeller.
            </li>
            <li>
              <strong>Opbevaring og sletning:</strong> Begivenheder og
              adgangstokens opbevares på vores servere i EU og overføres
              krypteret. Adgangstokens til Google gemmes desuden krypteret i
              databasen (AES-256-GCM). Afbryder du forbindelsen under
              Indstillinger → Integrationer, sletter vi dine tokens og de
              begivenheder, vi har hentet fra Google. Du kan også fjerne
              TimeTracks adgang i din{" "}
              <a
                href="https://myaccount.google.com/connections"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:text-brand-700"
              >
                Google-konto
              </a>
              .
            </li>
          </ul>
          <div className="mt-4 rounded-2xl border border-brand-200 bg-brand-50 p-6">
            <p className="text-sm text-slate-700">
              TimeTrack&apos;s use and transfer to any other app of information
              received from Google APIs will adhere to the{" "}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:text-brand-700"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
            <p className="mt-2 text-sm text-slate-700">
              På dansk: TimeTracks brug og overførsel af oplysninger modtaget
              fra Googles API&apos;er følger Google API Services User Data
              Policy, herunder kravene om begrænset brug (Limited Use).
            </p>
          </div>

          <p className="mt-6 text-slate-600">
            Vi sælger <strong>aldrig</strong> dine data til tredjeparter. Vi
            bruger <strong>ikke</strong> Google Analytics, Facebook Pixel eller
            andre tracking-værktøjer fra tredjepart.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            5. Hvor Længe Gemmer Vi Dine Data?
          </h2>
          <p className="text-slate-600">
            Vi gemmer dine data så længe du har en aktiv konto hos os. Hvis du
            sletter din konto, anonymiserer vi eller sletter dine
            personoplysninger inden for 30 dage, medmindre vi er juridisk
            forpligtet til at opbevare dem længere (f.eks. 5 års
            opbevaringspligt for bogføringsdata jf. bogføringsloven).
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>
              <strong>Login-sessioner:</strong> 7 dage
            </li>
            <li>
              <strong>Betalingshændelser:</strong> 90 dage
            </li>
            <li>
              <strong>Fejlrapporter (Sentry):</strong> 90 dage
            </li>
            <li>
              <strong>Bogføringsrelaterede data:</strong> Op til 5 år jf.
              bogføringsloven
            </li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            6. Dine Rettigheder
          </h2>
          <p className="text-slate-600">
            I henhold til GDPR har du følgende rettigheder:
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>
              <strong>Ret til indsigt:</strong> Du kan anmode om en kopi af dine
              data
            </li>
            <li>
              <strong>Ret til rettelse:</strong> Du kan rette unøjagtige data
            </li>
            <li>
              <strong>Ret til sletning:</strong> Du kan anmode om at få dine
              data slettet
            </li>
            <li>
              <strong>Ret til dataportabilitet:</strong> Du kan eksportere dine
              data
            </li>
            <li>
              <strong>Ret til indsigelse:</strong> Du kan gøre indsigelse mod
              behandling
            </li>
          </ul>
          <p className="mt-4 text-slate-600">
            For at udøve dine rettigheder, kontakt os på{" "}
            <a
              href="mailto:timetrack@timetrack.dk"
              className="text-brand-600 hover:text-brand-700"
            >
              timetrack@timetrack.dk
            </a>
            . Du kan også læse mere om dine rettigheder hos{" "}
            <a
              href="https://www.datatilsynet.dk/borger/dine-rettigheder"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:text-brand-700"
            >
              Datatilsynet
            </a>
            .
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            7. Sikkerhed
          </h2>
          <p className="text-slate-600">
            Vi bruger industristandard sikkerhedsforanstaltninger for at
            beskytte dine data, herunder:
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>SSL/TLS kryptering for datatransmission</li>
            <li>
              Adgangstokens, API-nøgler og adgangskoder til integrationer
              (Google Calendar, iCloud-kalender, Billy, Dinero, e-conomic,
              TimeOps-import, IMAP-mail og din egen OpenAI-nøgle) gemmes
              krypteret i databasen (AES-256-GCM)
            </li>
            <li>Krypterede database backups</li>
            <li>Regelmæssige sikkerhedsopdateringer</li>
            <li>Adgangskontrol og autentificering</li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            8. Cookies
          </h2>
          <p className="text-slate-600">
            Vi bruger kun absolut nødvendige cookies til session management og
            login. Vi bruger IKKE marketing cookies eller tracking cookies fra
            tredjeparter. Læs mere i vores{" "}
            <Link
              href="/cookies"
              className="text-brand-600 hover:text-brand-700"
            >
              Cookie Politik
            </Link>
            .
          </p>
          <p className="mt-4 text-slate-600">
            Vores analytics (Plausible) er cookieløs og respekterer Do Not Track
            (DNT) browser-indstillinger.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            9. Ændringer Til Denne Politik
          </h2>
          <p className="text-slate-600">
            Vi kan opdatere denne privatlivspolitik fra tid til anden. Vi vil
            notificere dig om væsentlige ændringer via email eller gennem
            platformen.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            10. Kontakt Os
          </h2>
          <p className="text-slate-600">
            Hvis du har spørgsmål om denne privatlivspolitik, kontakt os:
          </p>
          <div className="mt-4 rounded-2xl bg-slate-50 p-6">
            <p className="text-slate-700">
              <strong>Email:</strong>{" "}
              <a
                href="mailto:timetrack@timetrack.dk"
                className="text-brand-600 hover:text-brand-700"
              >
                timetrack@timetrack.dk
              </a>
              <br />
              <strong>Virksomhed:</strong> Mahope (Mahoje) v/ Mads Holst Jensen
              <br />
              <strong>CVR:</strong> 39413892
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
