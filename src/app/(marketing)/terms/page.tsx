import type { Metadata } from "next";

import { Footer } from "@/components/Footer";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Servicevilkår",
  description:
    "Servicevilkår for TimeTrack: abonnement, prøveperiode, opsigelse, dataejerskab og ansvar. Læs vilkårene for brug af tjenesten.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navigation />

      <MarketingHero
        title="Servicevilkår"
        subtitle="Sidst opdateret: 23. oktober 2026"
      />

      {/* Content Section */}
      <section className="px-4 py-24 sm:px-6 lg:px-8">
        <div className="typeset typeset-doc mx-auto max-w-4xl">
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-6">
            <p className="text-sm text-slate-700">
              Ved at bruge TimeTrack accepterer du disse servicevilkår. Læs dem
              venligst grundigt igennem.
            </p>
          </div>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            1. Accept Af Vilkår
          </h2>
          <p className="text-slate-600">
            Ved at oprette en konto og bruge TimeTrack accepterer du at være
            bundet af disse servicevilkår. Hvis du ikke accepterer disse vilkår,
            må du ikke bruge tjenesten.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            2. Beskrivelse Af Tjenesten
          </h2>
          <p className="text-slate-600">
            TimeTrack er en cloud-baseret tjeneste til tidsregistrering,
            designet til danske freelancere. Tjenesten tilbyder:
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>Tidstracking og klippekort-system</li>
            <li>Projekt- og kundehåndtering</li>
            <li>Fakturering og rapporter</li>
            <li>Integrationer med danske værktøjer (Billy, Dinero, CVR)</li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            3. Brugerkonti
          </h2>
          <p className="text-slate-600">
            For at bruge TimeTrack skal du oprette en konto. Du er ansvarlig
            for:
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>At holde dine loginoplysninger sikre</li>
            <li>Al aktivitet der sker under din konto</li>
            <li>At give korrekte og opdaterede oplysninger</li>
            <li>At notificere os straks ved uautoriseret brug af din konto</li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            4. Priser Og Betalinger
          </h2>
          <h3 className="mb-3 mt-6 text-xl font-semibold text-slate-900">
            4.1 Abonnementer
          </h3>
          <p className="text-slate-600">TimeTrack tilbyder flere planer:</p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>
              <strong>Planer og priser:</strong> De til enhver tid gældende
              planer og priser fremgår af prissiden (timetrack.dk/pricing)
            </li>
            <li>
              <strong>Årlig betaling:</strong> svarer til 10 måneders pris (2
              måneder gratis)
            </li>
            <li>
              <strong>Prøveperiode:</strong> 30 dage gratis - ingen binding
            </li>
          </ul>

          <h3 className="mb-3 mt-6 text-xl font-semibold text-slate-900">
            4.2 Betalingsbetingelser
          </h3>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>
              Priser ved køb direkte hos TimeTrack er i danske kroner (DKK) og
              ekskl. moms. Ved køb i appen gælder den pris, butikken viser ved
              købet
            </li>
            <li>
              Ved køb direkte hos TimeTrack sker betaling månedligt eller årligt
              forud via kort. Ved køb i appen betaler du via butikken
            </li>
            <li>
              30 dages gratis prøveperiode uden betalingskort. Bagefter
              fortsætter kontoen på Gratis.
            </li>
            <li>
              Du kan opsige dit abonnement når som helst uden binding (køb i
              appen opsiges i butikken)
            </li>
          </ul>

          <h3 className="mb-3 mt-6 text-xl font-semibold text-slate-900">
            4.3 Refunderinger
          </h3>
          <p className="text-slate-600">
            Vi tilbyder 14 dages tilbagebetalingsgaranti på abonnementer, der er
            betalt direkte hos TimeTrack. Kontakt os på timetrack@timetrack.dk
            for at anmode om refundering. Køb i TimeTrack-appen refunderes efter
            butikkens regler, se 4.4.
          </p>

          <h3 className="mb-3 mt-6 text-xl font-semibold text-slate-900">
            4.4 Køb via App Store og Google Play
          </h3>
          <p className="text-slate-600">
            Køber du et abonnement i TimeTrack-appen, sker købet hos Apple (App
            Store) eller Google (Google Play). Betaling, fornyelse, opsigelse og
            refundering følger butikkens vilkår, og du administrerer
            abonnementet i butikken under dine abonnementer. Abonnementet
            fornyes automatisk for samme periode, indtil du opsiger det i
            butikken. Opsiger du senest 24 timer før periodens udløb, bliver du
            ikke trukket for den næste periode. Ændres prisen, giver butikken
            dig besked efter sine regler. Sletter du din TimeTrack-konto,
            stopper butikkens abonnement ikke af sig selv; opsig det i butikken.
            Refundering af køb i appen behandles som udgangspunkt af Apple eller
            Google. Henviser butikken dig til os, så skriv til
            timetrack@timetrack.dk. Apple og Google behandler dine
            betalingsoplysninger som selvstændige dataansvarlige, og TimeTrack
            modtager ikke dine kortoplysninger.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            5. AI-funktioner
          </h2>
          <p className="text-slate-600">
            TimeTrack tilbyder valgfrie AI-funktioner (opgaveforslag,
            tidsestimering, kategorisering). De virker kun, når du selv
            indsætter en nøgle til en AI-udbyder under Indstillinger. Ved brug
            af disse gælder:
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>
              AI-funktioner er <strong>deaktiveret som standard</strong> og
              kræver dit aktive valg
            </li>
            <li>
              Relevante opgavetekster og tidsdata sendes til den AI-udbyder, du
              har valgt, for at levere forslag, aldrig adgangskoder,
              betalingsinfo eller personlige beskeder
            </li>
            <li>
              AI-genererede forslag er vejledende og kan indeholde fejl. Du er
              selv ansvarlig for at verificere og godkende forslag inden brug
            </li>
            <li>
              Du kan bruge din egen OpenAI API-nøgle (BYOK) under Indstillinger,
              så data sendes direkte til din egen konto
            </li>
            <li>
              Vi er ikke ansvarlige for nøjagtigheden af AI-genereret indhold
            </li>
            <li>Du kan deaktivere AI-funktioner når som helst</li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            6. Acceptabel Brug
          </h2>
          <p className="text-slate-600">Du må ikke bruge TimeTrack til at:</p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>Dele ulovligt indhold eller krænke andres rettigheder</li>
            <li>Sende spam eller phishing-emails</li>
            <li>Forsøge at hacke eller kompromittere systemet</li>
            <li>Bruge tjenesten til ulovlige formål</li>
            <li>Oprette flere gratis konti for at omgå begrænsninger</li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            7. Data Og Ejerskab
          </h2>
          <p className="text-slate-600">
            Du beholder alle rettigheder til dine data. Vi er ikke ejere af de
            data, du lægger i systemet. Du kan til enhver tid:
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>
              Selv hente alle dine data som én fil under Indstillinger → Import
              & eksport, også uden betalt abonnement. Har du et team, kan ejere
              og administratorer hente hele teamets data, og hver medarbejder
              kan hente sine egne (hvad eksporterne omfatter, står på{" "}
              <a
                href="/tillid#eksport"
                className="text-brand-600 hover:text-brand-700"
              >
                timetrack.dk/tillid
              </a>
              )
            </li>
            <li>Slette din konto og alle tilhørende data</li>
            <li>Flytte dine data til en anden platform</li>
          </ul>
          <p className="mt-4 text-slate-600">
            Bruger du TimeTrack til oplysninger om andre, fx medarbejdere eller
            dine kunder, er TimeTrack din databehandler, og{" "}
            <a
              href="/databehandleraftale"
              className="text-brand-600 hover:text-brand-700"
            >
              databehandleraftalen
            </a>{" "}
            er en del af disse vilkår. Databehandleraftalens version 1.1 gælder
            for nye kunder fra den dag, den er offentliggjort på
            timetrack.dk/databehandleraftale, og for eksisterende kunder 30 dage
            efter, at de har fået en mail om den. Indtil da gælder den tidligere
            version.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            8. Service Level Agreement (SLA)
          </h2>
          <p className="text-slate-600">Vi stræber efter at tilbyde:</p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>99.9% uptime på årsbasis</li>
            <li>Daglige automatiske backups af dine data</li>
            <li>24 timers support responstid</li>
          </ul>
          <p className="mt-4 text-slate-600">
            Vi notificerer om planlagt vedligeholdelse mindst 48 timer i
            forvejen.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            9. Opsigelse
          </h2>
          <h3 className="mb-3 mt-6 text-xl font-semibold text-slate-900">
            9.1 Din Opsigelse
          </h3>
          <p className="text-slate-600">
            Har du købt abonnementet direkte hos TimeTrack, kan du opsige det
            når som helst gennem din konto. Har du købt det i appen, opsiger du
            det i App Store eller Google Play, se 4.4. Din adgang fortsætter til
            slutningen af din betalingsperiode.
          </p>

          <h3 className="mb-3 mt-6 text-xl font-semibold text-slate-900">
            9.2 Vores Opsigelse
          </h3>
          <p className="text-slate-600">
            Vi forbeholder os retten til at suspendere eller opsige din konto
            hvis du overtræder disse vilkår, med 30 dages varsel.
          </p>

          <h3
            id="lukning"
            className="mb-3 mt-6 scroll-mt-24 text-xl font-semibold text-slate-900"
          >
            9.3 Hvis TimeTrack lukker
          </h3>
          <p className="text-slate-600">
            Lukker TimeTrack som tjeneste, gælder følgende:
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>Du får besked på mail mindst 6 måneder før lukningen.</li>
            <li>
              Du kan selv hente alle dine data som én fil, også vedhæftede
              filer, hændelseslog og godkendelseshistorik, indtil tjenesten
              lukker.
            </li>
            <li>
              Har du betalt forud for en periode efter lukningen, får du den
              ubrugte del refunderet.
            </li>
            <li>
              Dine data slettes derefter efter databehandleraftalen, også i
              backup.
            </li>
          </ul>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            10. Ansvarsfraskrivelse
          </h2>
          <p className="text-slate-600">
            TimeTrack leveres "som den er" uden garantier af nogen art. Vi er
            ikke ansvarlige for:
          </p>
          <ul className="mt-4 space-y-2 text-slate-600">
            <li>Tab af data eller indtjening</li>
            <li>Indirekte eller følgeskader</li>
            <li>Tredjepartsintegrationer der fejler</li>
            <li>
              Nøjagtigheden af AI-genererede forslag, estimater eller
              kategoriseringer
            </li>
          </ul>
          <p className="mt-4 text-slate-600">
            Vores maksimale ansvar er begrænset til det beløb, du har betalt i
            de seneste 12 måneder.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            11. Ændringer Til Vilkårene
          </h2>
          <p className="text-slate-600">
            Vi kan opdatere disse vilkår fra tid til anden. Ved væsentlige
            ændringer vil vi notificere dig via email mindst 30 dage i forvejen.
            Det gælder også nye versioner af databehandleraftalen: en ny version
            gælder for nye kunder fra offentliggørelsen og for eksisterende
            kunder 30 dage efter varslingsmailen.
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            12. Lovvalg
          </h2>
          <p className="text-slate-600">
            Disse vilkår er underlagt dansk lov. Eventuelle tvister skal
            behandles ved danske domstole. Læs mere om forbrugerrettigheder hos{" "}
            <a
              href="https://www.forbrugerombudsmanden.dk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-600 hover:text-brand-700"
            >
              Forbrugerombudsmanden
            </a>
            .
          </p>

          <h2 className="mb-4 mt-12 text-2xl font-bold text-slate-900">
            13. Kontakt
          </h2>
          <p className="text-slate-600">
            Hvis du har spørgsmål til disse vilkår, kontakt os:
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
