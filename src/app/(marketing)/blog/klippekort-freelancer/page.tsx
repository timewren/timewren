import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { getMarketingUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Klippekort til kunder: Sådan sælger du forudbetalte timer",
  description:
    "Klippekort giver forudsigelig indtægt og trygge kunder. Trin-for-trin guide til at sætte klippekort op som freelancer.",
  openGraph: {
    title: "Klippekort til kunder: Sådan sælger du forudbetalte timer",
    description:
      "Klippekort giver forudsigelig indtægt og trygge kunder. Trin-for-trin guide til at komme i gang.",
  },
  alternates: { canonical: "/blog/klippekort-freelancer" },
};

export default function KlippekortFreelancerPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Klippekort til kunder: Sådan sælger du forudbetalte timer",
    description:
      "Klippekort giver forudsigelig indtægt og trygge kunder. Trin-for-trin guide.",
    author: {
      "@type": "Person",
      name: "Mads Holst Jensen",
    },
    publisher: {
      "@type": "Organization",
      name: "TimeTrack",
      url: "https://timetrack.dk",
    },
    datePublished: "2026-05-23",
    dateModified: "2026-05-23",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": new URL("/blog/klippekort-freelancer", getMarketingUrl()).href,
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
            Klippekort til kunder: Sådan sælger du forudbetalte timer
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Klippekort giver dig forudsigelig indtægt og dine kunder tryghed.
            Her er hvordan du kommer i gang.
          </p>
          <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
            <span>Af Mads Holst Jensen</span>
            <span>23. maj 2026</span>
            <span>6 min læsetid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-slate-700 leading-relaxed">
          <h2 className="text-2xl font-bold text-slate-900">
            Hvad er et klippekort?
          </h2>
          <p>
            Et klippekort (eller &quot;prepaid timer&quot;) er en aftale hvor
            kunden køber et antal timer på forhånd. Du trækker fra klippekortet
            efterhånden som du arbejder, og kunden kan følge med i forbruget.
          </p>
          <p>
            Tænk på det som et gavekort til din tid. Kunden betaler f.eks. for
            20 timer, og du registrerer løbende hvad tiden bruges på.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvorfor klippekort virker
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">For dig</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Forudsigelig indtægt:</strong> du ved hvad der kommer ind
            </li>
            <li>
              <strong>Ingen faktura-diskussioner:</strong> kunden har allerede
              betalt
            </li>
            <li>
              <strong>Lettere planlægning:</strong> du kan se hvem der har timer
              tilbage
            </li>
          </ul>

          <h3 className="text-xl font-semibold text-slate-900">For kunden</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Overblik:</strong> kunden kan se saldo og historik
            </li>
            <li>
              <strong>Ingen overraskelser:</strong> de kender budgettet på
              forhånd
            </li>
            <li>
              <strong>Hurtig hjælp:</strong> de slipper for at godkende hvert
              enkelt stykke arbejde
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            Trin-for-trin: Sæt klippekort op
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">
            1. Beslut pakke-størrelsen
          </h3>
          <p>
            Start med 10 eller 20 timer. Det er stort nok til at kunden får
            værdi, men småt nok til at det ikke føles som en stor investering.
          </p>
          <p>
            <strong>Tip:</strong> Se på hvor mange timer du typisk bruger pr.
            måned for kunden. Vælg en pakke der dækker 1-2 måneder.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            2. Sæt prisen
          </h3>
          <p>
            De fleste freelancere bruger deres normale timesats. Nogle giver en
            lille rabat (5-10%) som incitament til at købe klippekortet.
          </p>
          <p>
            <strong>Eksempel:</strong> 20 timer × 800 kr/t = 16.000 kr. Med 5%
            klippekort-rabat: 15.200 kr.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            3. Fakturér klippekortet
          </h3>
          <p>
            Send en faktura for hele klippekortet når kunden køber det. Så er
            pengene i hus, og du kan fokusere på arbejdet.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            4. Registrér tid og træk fra
          </h3>
          <p>
            Hver gang du arbejder for kunden, registrerer du din tid og
            tilknytter den klippekortet. Systemet trækker automatisk fra
            saldoen.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            5. Giv kunden indblik
          </h3>
          <p>
            Del en rapport eller kundeportal-adgang, så kunden selv kan se hvad
            timerne er brugt på og hvor mange der er tilbage.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvornår skal du IKKE bruge klippekort
          </h2>
          <p>Klippekort passer ikke til alle situationer. Undgå dem ved:</p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              Engangsprojekter med fast pris (brug fastpris-faktura i stedet)
            </li>
            <li>Kunder du kun arbejder for én gang</li>
            <li>Meget uforudsigelige opgaver hvor scope ændrer sig konstant</li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            Den vigtigste ting
          </h2>
          <p>
            Start med én kunde. Den du har mest løbende arbejde for. Opret et
            klippekort, registrér tid i en måned, og se om det giver mere ro i
            jeres samarbejde.
          </p>
          <p>Det gør det næsten altid.</p>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-slate-50 p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            Prøv klippekort i TimeTrack
          </h2>
          <p className="mt-2 text-slate-600">
            Opret klippekort, registrér tid og giv kunden adgang i ét system.
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
                href="/klippekort"
                className="text-brand-600 hover:text-brand-700"
              >
                Klippekort i TimeTrack →
              </Link>
            </li>
          </ul>
        </div>
      </article>

      <Footer />
    </div>
  );
}
