import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { getMarketingUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "5 fakturerings-fejl freelancere laver (og hvordan du undgår dem)",
  description:
    "De fleste freelancere taber penge på fakturering uden at vide det. Her er de 5 mest udbredte fejl med en praktisk løsning til hver.",
  openGraph: {
    title: "5 fakturerings-fejl freelancere laver (og hvordan du undgår dem)",
    description:
      "De fleste freelancere taber penge på fakturering uden at vide det. Her er de 5 mest udbredte fejl.",
  },
  alternates: { canonical: "/blog/fakturering-fejl-freelancer" },
};

export default function FaktureringFejlFreelancerPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline:
      "5 fakturerings-fejl freelancere laver (og hvordan du undgår dem)",
    description:
      "De fleste freelancere taber penge på fakturering. Her er de 5 mest udbredte fejl og en praktisk løsning til hver.",
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
    datePublished: "2026-03-12",
    dateModified: "2026-03-12",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": new URL("/blog/fakturering-fejl-freelancer", getMarketingUrl())
        .href,
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

      <article className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
        <header>
          <Link
            href="/blog"
            className="text-sm text-brand-600 hover:text-brand-700"
          >
            &larr; Tilbage til blog
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            5 fakturerings-fejl freelancere laver (og hvordan du undgår dem)
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Fakturering virker simpelt, indtil du opdager at du taber penge hver
            måned. Her er de fejl du sandsynligvis laver, og hvad du kan gøre
            ved dem.
          </p>
          <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
            <span>Af Mads Holst Jensen</span>
            <span>12. marts 2026</span>
            <span>8 min læsetid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-slate-700 leading-relaxed">
          <p>
            Som freelancer er fakturering det der omsætter dit arbejde til
            penge. Men de fleste af os har aldrig fået undervisning i det. Vi
            kopierer en fakturaskabelon, sætter et beløb ind og håber det
            bedste.
          </p>
          <p>
            Resultatet er at mange freelancere konsekvent underfakturerer,
            venter for længe med at sende, og ender med at bruge timer på at
            jagte betalinger. Her er de 5 mest udbredte fejl med en konkret
            løsning til hver.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Fejl 1: Upræcis tidsregistrering
          </h2>
          <p>
            Den absolut dyreste fejl. Hvis du ikke registrerer din tid løbende,
            ender du med at estimere, og mennesker er notorisk dårlige til at
            estimere tid. Vi husker den store opgave, men glemmer de 15 minutter
            vi brugte på at svare på mails, de 30 minutter til et hurtigt
            opkald, og den halve time til research.
          </p>
          <p>
            Regn selv efter: glemmer du bare 10 % af tiden, og fakturerer du
            80.000 kr. om måneden, er det{" "}
            <strong>8.000 kr. i tabt omsætning hver måned</strong>.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">Løsningen</h3>
          <p>
            Brug en timer. Start den når du begynder at arbejde, stop den når du
            stopper. Det tager 2 sekunder, og det er den mest profitable vane du
            kan opbygge som freelancer.
          </p>
          <p>
            Registrér alt, også telefonopkald, emails og små opgaver. Det er
            netop de ting der falder mellem sprækkerne.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Fejl 2: Venter for længe med at fakturere
          </h2>
          <p>
            Mange freelancere fakturerer én gang om måneden eller værre:
            &quot;når de kommer til det&quot;. Problemet er dobbelt:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              Jo længere du venter, jo sværere er det at huske hvad du lavede
              (og jo mere underfakturerer du)
            </li>
            <li>
              Hver dag du venter med at sende fakturaen, er en dag du venter på
              betaling. Med 30 dages betalingsfrist og 2 ugers forsinkelse på
              fakturering er du 6 uger fra dine penge
            </li>
          </ul>

          <h3 className="text-xl font-semibold text-slate-900">Løsningen</h3>
          <p>
            Sæt en fast dag til fakturering. Hver fredag, hver 14. dag, eller
            hvad der passer dit flow. Gør det til en rutine der ikke kræver
            overvejelse. Åbn dit tidsregistreringssystem, gennemse ugens timer,
            og send fakturaen.
          </p>
          <p>
            Hvis du bruger et værktøj der kan eksportere direkte til dit
            regnskabsprogram, tager hele processen under 10 minutter.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Fejl 3: Glemmer udgifter og tillæg
          </h2>
          <p>
            Du køber et WordPress-plugin til kundens hjemmeside (600 kr). Du
            betaler for et stock-foto til deres kampagne (200 kr). Du tager
            bilen til et kundemøde (150 km tur/retur).
          </p>
          <p>
            Alle disse udgifter hører til på fakturaen. Men mange freelancere
            glemmer dem, enten fordi de ikke noterer dem løbende, eller fordi de
            føler det er &quot;småting&quot;.
          </p>
          <p>
            Problemet er at småting lægger sig sammen. 500-1.000 kr i glemte
            udlæg per måned er 6.000-12.000 kr om året der kommer direkte ud af
            din egen lomme.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">Løsningen</h3>
          <p>
            Notér udlæg i det øjeblik du betaler dem. De fleste
            tidsregistreringssystemer har en funktion til udgifter. Brug den.
            Alternativt kan du oprette et notat eller en mappe på telefonen hvor
            du fotograferer kvitteringer og noterer beløbet.
          </p>
          <p>
            Sæt en klar aftale med kunden fra start: &quot;Udlæg faktureres
            separat ud over timeprisen.&quot; Så undgår du diskussioner
            bagefter.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Fejl 4: Uklare betalingsbetingelser
          </h2>
          <p>
            &quot;Betales hurtigst muligt&quot; er ikke en betalingsbetingelse.
            Det er et håb. Og det er overraskende mange freelancere der sender
            fakturaer uden klare vilkår og derefter undrer sig over at
            betalingen trækker ud.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">Løsningen</h3>
          <p>
            Angiv altid en konkret betalingsfrist. Standarden i Danmark er
            &quot;netto 8 dage&quot; eller &quot;netto 14 dage&quot;. Større
            virksomheder beder ofte om 30 dage. Det er acceptabelt, men bør
            aftales eksplicit.
          </p>
          <p>Inkludér også:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Morarente:</strong> den lovpligtige rente ved for sen
              betaling (Nationalbankens udlånsrente + 8 procentpoint)
            </li>
            <li>
              <strong>Kompensationsgebyr:</strong> du har ret til 310 kr i
              kompensation ved for sen betaling fra erhvervskunder
            </li>
            <li>
              <strong>Betalingsmetode:</strong> bankoverførsel med kontonummer
              og eventuelt MobilePay-nummer
            </li>
          </ul>
          <p>
            Skriv disse vilkår ind i din kontrakt eller samarbejdsaftale og
            gentag dem på fakturaen. Kunden skal aldrig være i tvivl om hvornår
            og hvordan der skal betales.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Fejl 5: Følger ikke op på forfaldne fakturaer
          </h2>
          <p>
            Du sender en faktura, betalingsfristen udløber, og... ingenting.
            Mange freelancere venter tålmodigt. Nogle sender en forsigtig
            påmindelse efter 2-3 uger. Andre lader det glide og håber kunden
            husker det selv.
          </p>
          <p>
            Virkeligheden er at de fleste sene betalinger ikke skyldes ond
            vilje. Fakturaen er røget ned i en indbakke, bogholderen har holdt
            ferie, eller kunden har simpelthen glemt det. En venlig påmindelse
            løser næsten altid problemet.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">Løsningen</h3>
          <p>Lav et fast opfølgningssystem:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Dag 1 efter forfald:</strong> Send en venlig påmindelse.
              &quot;Hej [navn], jeg kan se at faktura #123 stod til betaling i
              går. Vil du tjekke om den er gået igennem?&quot;
            </li>
            <li>
              <strong>7 dage efter forfald:</strong> Send en rykker med
              henvisning til betalingsvilkår
            </li>
            <li>
              <strong>14 dage efter forfald:</strong> Ring til kunden. Det er
              ikke ubehageligt. Det er professionelt
            </li>
            <li>
              <strong>30+ dage:</strong> Overvej inkasso eller rki-varsel. De
              fleste betaler når de ser det brev
            </li>
          </ul>
          <p>
            Mange regnskabsprogrammer kan automatisere de første påmindelser.
            Brug den funktion. Det er nemmere at lade systemet sende end at
            sidde og finde modet selv.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Bonusfejl: Ingen kontrakt
          </h2>
          <p>
            Jeg nævner den som bonus, fordi den egentlig er en aftale-fejl, men
            den påvirker din fakturering direkte. Uden en skriftlig aftale har
            du intet at henvise til når kunden bestrider en faktura.
          </p>
          <p>
            Det behøver ikke være 10 sider jura. Et enkelt dokument der
            beskriver: hvad du leverer, hvad det koster, hvornår det faktureres,
            og hvad betalingsfristen er. Det tager 30 minutter at skrive, og det
            sparer dig for dage i diskussioner.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Sammenfatning: Det koster dig penge
          </h2>
          <p>
            Hver eneste af disse fejl koster dig penge. Ikke i store, dramatiske
            beløb, men i en stille strøm af tabte timer, glemte udlæg og
            forsinkede betalinger der lægger sig sammen over et år.
          </p>
          <p>
            Den gode nyhed er at alle fem fejl har enkle løsninger. Det kræver
            ikke mere tid. Det kræver bedre rutiner. Start med én ting:
            registrér din tid konsekvent. Resten følger naturligt.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-slate-50 p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            Stop med at tabe penge på fakturering
          </h2>
          <p className="mt-2 text-slate-600">
            TimeTrack hjælper dig med præcis tidsregistrering, automatiske
            rapporter og direkte fakturering.
          </p>
          <Link
            href="/register"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white hover:bg-brand-700"
          >
            Start gratis
            <ArrowRight className="h-5 w-5" />
          </Link>
          <p className="mt-2 text-sm text-slate-500">
            Prøv gratis i 30 dage. Intet betalingskort.
          </p>
        </div>

        {/* Related links */}
        <div className="mt-12 border-t border-slate-200 pt-8">
          <h3 className="font-semibold text-slate-900">Relaterede artikler</h3>
          <ul className="mt-4 space-y-2">
            <li>
              <Link
                href="/blog/timeregistrering-freelancer-guide"
                className="text-brand-600 hover:text-brand-700"
              >
                Timeregistrering som freelancer: Den komplette guide &rarr;
              </Link>
            </li>
            <li>
              <Link
                href="/blog/billy-timeregistrering-guide"
                className="text-brand-600 hover:text-brand-700"
              >
                Billy + TimeTrack: Tidsregistrering der flyder ind i din faktura
                &rarr;
              </Link>
            </li>
            <li>
              <Link
                href="/blog/freelancer-timepris-2026"
                className="text-brand-600 hover:text-brand-700"
              >
                Hvad koster en freelancer per time i 2026? &rarr;
              </Link>
            </li>
          </ul>
        </div>
      </article>

      <Footer />
    </div>
  );
}
