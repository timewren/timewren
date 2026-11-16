import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Tidsregistreringslov i Danmark: Hvad du skal vide som freelancer",
  description:
    "Forstå den danske tidsregistreringslov (L68) og hvordan den påvirker dig som freelancer. Lovkrav, undtagelser og praktiske tips til compliance.",
  openGraph: {
    title: "Tidsregistreringslov i Danmark: Hvad du skal vide som freelancer",
    description:
      "Den danske tidsregistreringslov forklaret for freelancere. Lovkrav, undtagelser og praktiske tips.",
  },
  alternates: { canonical: "/blog/tidsregistrering-lov-danmark" },
};

export default function TidsregistreringLovDanmarkPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline:
      "Tidsregistreringslov i Danmark: Hvad du skal vide som freelancer",
    description:
      "Forstå den danske tidsregistreringslov (L68) og hvordan den påvirker dig som freelancer.",
    author: {
      "@type": "Person",
      name: "Mads Holst Jensen",
    },
    publisher: {
      "@type": "Organization",
      name: "TimeTrack",
      url: "https://timetrack.dk",
    },
    datePublished: "2026-03-28",
    dateModified: "2026-10-01",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": "https://timetrack.dk/blog/tidsregistrering-lov-danmark",
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
            ← Tilbage til blog
          </Link>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Tidsregistreringslov i Danmark: Hvad du skal vide som freelancer
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Den danske tidsregistreringslov stiller krav til registrering af
            arbejdstid. Her er hvad den betyder for dig som freelancer.
          </p>
          <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
            <span>Af Mads Holst Jensen</span>
            <span>28. marts 2026</span>
            <span>7 min l&aelig;setid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-slate-700 leading-relaxed">
          <h2 className="text-2xl font-bold text-slate-900">
            Hvad handler loven om?
          </h2>
          <p>
            Den 1. juli 2024 tr&aring;dte den danske tidsregistreringslov (L68)
            i kraft. Loven implementerer en EU-dom fra 2019, som slog fast at
            alle EU-medlemsstater skal sikre, at arbejdsgivere registrerer deres
            medarbejderes daglige arbejdstid.
          </p>
          <p>
            Form&aring;let er at beskytte medarbejdere mod overarbejde og sikre
            overholdelse af reglerne om hviletid og maksimal ugentlig
            arbejdstid. Loven &aelig;ndrer den danske arbejdstidslov og stiller
            konkrete krav til, hvad der skal registreres, men ikke til metoden.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvem er omfattet af loven?
          </h2>
          <p>
            Loven g&aelig;lder prim&aelig;rt for{" "}
            <strong>arbejdsgivere med ansatte</strong>. Det er arbejdsgiverens
            pligt at s&oslash;rge for, at der findes et p&aring;lideligt system
            til registrering af medarbejdernes arbejdstid.
          </p>
          <p>
            Som <strong>selvst&aelig;ndig freelancer uden ansatte</strong> er du
            ikke direkte omfattet af lovkravene. Du har ingen medarbejdere at
            beskytte, s&aring; loven p&aring;l&aelig;gger dig ikke nogen pligt.
          </p>
          <p>Men der er vigtige undtagelser:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Har du ansatte?</strong> S&aring; skal du registrere deres
              arbejdstid. Ogs&aring; selv om du kun har &eacute;n deltidsansat.
            </li>
            <li>
              <strong>Arbejder du som konsulent hos en kunde?</strong> Kunden
              kan kr&aelig;ve, at du registrerer tid i deres system, men det er
              et krav i jeres aftale, ikke i loven.
            </li>
            <li>
              <strong>Er du &quot;selvtilrettel&aelig;gger&quot;?</strong>{" "}
              Medarbejdere, hvis arbejdstid ikke m&aring;les eller
              fasts&aelig;ttes p&aring; forh&aring;nd, eller som selv
              fasts&aelig;tter den, kan v&aelig;re undtaget fra dele af loven.
              Det skal st&aring; i ans&aelig;ttelseskontrakten, og undtagelsen
              er sn&aelig;ver.
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvad skal registreres?
          </h2>
          <p>
            Loven kr&aelig;ver at arbejdsgiveren registrerer den{" "}
            <strong>daglige arbejdstid</strong> for hver medarbejder.
            Registreringen skal v&aelig;re:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Tilg&aelig;ngelig for medarbejderen:</strong> den ansatte
              skal kunne se sin egen registrering
            </li>
            <li>
              <strong>Opbevaret i 5 &aring;r:</strong> efter referenceperiodens
              udl&oslash;b
            </li>
            <li>
              <strong>P&aring;lidelig:</strong> systemet skal v&aelig;re
              objektivt og tilg&aelig;ngeligt
            </li>
          </ul>
          <p>
            Loven specificerer ikke <em>hvordan</em> tiden skal registreres. Det
            kan v&aelig;re digitalt, p&aring; papir eller i et
            tidsregistreringssystem. Men et digitalt system g&oslash;r det langt
            nemmere at overholde opbevaringskravene.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Konsekvenser ved manglende registrering
          </h2>
          <p>
            Loven har ingen bødebestemmelse, og der kan ikke tilkendes
            godtgørelse alene for manglende registrering. Men mangler
            registreringen, kan det få processuel skadevirkning for
            arbejdsgiveren, som står svagt i en tvist om overarbejde eller
            hviletid.
          </p>
          <p>
            Den fulde gennemgang af reglerne med henvisninger til lovteksten
            finder du i guiden til{" "}
            <Link
              href="/tidsregistrering-lovkrav"
              className="text-brand-600 underline"
            >
              lovkrav om tidsregistrering af medarbejdere
            </Link>
            .
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvorfor freelancere alligevel b&oslash;r registrere tid
          </h2>
          <p>
            Selvom loven m&aring;ske ikke direkte p&aring;l&aelig;gger dig
            noget, er der gode grunde til at registrere tid som freelancer:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Kundekrav:</strong> mange virksomheder kr&aelig;ver
              dokumentation for timer brugt, s&aelig;rligt ved klippekort og
              retaineraftaler
            </li>
            <li>
              <strong>Faktureringsgrundlag:</strong> pr&aelig;cis
              tidsregistrering giver et st&aelig;rkere grundlag n&aring;r du
              fakturerer
            </li>
            <li>
              <strong>Skat og moms:</strong> SKAT kan bede om dokumentation for
              dit arbejde ved revision
            </li>
            <li>
              <strong>Selvindsigt:</strong> du f&aring;r overblik over hvor din
              tid g&aring;r, og om dine projekter er rentable
            </li>
            <li>
              <strong>Fremtidssikring:</strong> hvis du f&aring;r ansatte eller
              underentrepren&oslash;rer, har du allerede et system p&aring;
              plads
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            Praktiske tips til compliance
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">
            1. V&aelig;lg et digitalt system
          </h3>
          <p>
            Et digitalt tidsregistreringssystem sikrer automatisk opbevaring, er
            tilg&aelig;ngeligt for medarbejdere og kan dokumentere arbejdstiden,
            hvis der opst&aring;r en tvist. Excel kan bruges, men det er
            sv&aelig;rere at vedligeholde over 5 &aring;r.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            2. Registr&eacute;r dagligt
          </h3>
          <p>
            Loven kr&aelig;ver et system, der kan m&aring;le den daglige
            arbejdstid. Registr&eacute;r gerne l&oslash;bende, s&aring; du ikke
            skal rekonstruere en hel uge fredag eftermiddag. Brug en timer der
            k&oslash;rer mens du arbejder, s&aring; slipper du for at huske.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            3. Dokumenter ogs&aring; pauser
          </h3>
          <p>
            Reglerne om hviletid kr&aelig;ver mindst 11 timers
            sammenh&aelig;ngende hvile i d&oslash;gnet og &eacute;t ugentligt
            fridogn. Et system der registrerer start- og sluttidspunkt kan
            automatisk dokumentere at disse regler overholdes.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            4. Opbevar data sikkert
          </h3>
          <p>
            Tidsregistreringsdata er persondata og skal behandles efter GDPR.
            S&oslash;rg for at dit system har ordentlig adgangsstyring og at
            data opbevares sikkert i mindst 5 &aring;r.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvordan TimeTrack hj&aelig;lper
          </h2>
          <p>
            TimeTrack er bygget til danske freelancere og sm&aring;
            virksomheder. Systemet underst&oslash;tter de krav som
            tidsregistreringsloven stiller:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              Daglig tidsregistrering med timer, manuel indtastning eller
              kalendervisning
            </li>
            <li>
              Fuld historik over alle registreringer, opbevaret s&aring;
              l&aelig;nge du har brug for det
            </li>
            <li>
              Rapporter og eksport til dokumentation over for medarbejdere,
              kunder eller SKAT
            </li>
            <li>
              Kundeportal s&aring; kunder og medarbejdere kan se deres egne
              registreringer
            </li>
            <li>Sikker opbevaring med adgangsstyring og kryptering</li>
          </ul>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-slate-50 p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            F&aring; styr p&aring; tidsregistreringen
          </h2>
          <p className="mt-2 text-slate-600">
            TimeTrack g&oslash;r det nemt at registrere tid og overholde
            lovkravene, ogs&aring; som freelancer.
          </p>
          <Link
            href="/register"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-8 py-4 font-semibold text-white hover:bg-brand-700"
          >
            Start gratis pr&oslash;veperiode
            <ArrowRight className="h-5 w-5" />
          </Link>
          <p className="mt-2 text-sm text-slate-500">
            Prøv gratis i 30 dage. Intet betalingskort.
          </p>
        </div>

        {/* Related */}
        <div className="mt-12 border-t border-slate-200 pt-8">
          <h3 className="font-semibold text-slate-900">Relaterede artikler</h3>
          <ul className="mt-4 space-y-2">
            <li>
              <Link
                href="/blog/timeregistrering-freelancer-guide"
                className="text-brand-600 hover:text-brand-700"
              >
                Timeregistrering som freelancer: Den komplette guide →
              </Link>
            </li>
            <li>
              <Link
                href="/blog/vaelg-tidsregistrering"
                className="text-brand-600 hover:text-brand-700"
              >
                S&aring;dan v&aelig;lger du det rigtige tidsregistreringssystem
                →
              </Link>
            </li>
          </ul>
        </div>
      </article>

      <Footer />
    </div>
  );
}
