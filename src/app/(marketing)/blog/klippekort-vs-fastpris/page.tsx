import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { getMarketingUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Klippekort vs. fastpris: Hvad er bedst for din freelance-forretning?",
  description:
    "Sammenlign klippekort (forudbetalte timer) med fastpris-projekter. Fordele, ulemper, hybridmodeller og tips til at pitche klippekort til kunder.",
  openGraph: {
    title:
      "Klippekort vs. fastpris: Hvad er bedst for din freelance-forretning?",
    description:
      "Klippekort eller fastpris? Fordele, ulemper og hybridmodeller for freelancere.",
  },
  alternates: { canonical: "/blog/klippekort-vs-fastpris" },
};

export default function KlippekortVsFastprisPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline:
      "Klippekort vs. fastpris: Hvad er bedst for din freelance-forretning?",
    description:
      "Sammenlign klippekort (forudbetalte timer) med fastpris-projekter. Fordele, ulemper og hybridmodeller.",
    author: {
      "@type": "Person",
      name: "Mads Holst Jensen",
    },
    publisher: {
      "@type": "Organization",
      name: "TimeTrack",
      url: "https://timetrack.dk",
    },
    datePublished: "2026-05-02",
    dateModified: "2026-05-02",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": new URL("/blog/klippekort-vs-fastpris", getMarketingUrl()).href,
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
            Klippekort vs. fastpris: Hvad er bedst for din freelance-forretning?
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            To prismodeller, to forskellige m&aring;der at drive freelance
            p&aring;. Her er hvorn&aring;r du skal bruge hvilken og hvordan du
            kombinerer dem.
          </p>
          <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
            <span>Af Mads Holst Jensen</span>
            <span>2. maj 2026</span>
            <span>7 min l&aelig;setid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-slate-700 leading-relaxed">
          <h2 className="text-2xl font-bold text-slate-900">
            De to modeller kort fortalt
          </h2>
          <p>
            Som freelancer har du grundl&aelig;ggende to m&aring;der at
            priss&aelig;tte dit arbejde p&aring;:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Klippekort (forudbetalte timer):</strong> kunden
              k&oslash;ber en blok af timer p&aring; forh&aring;nd. Du
              tr&aelig;kker fra efterh&aring;nden som du arbejder.
            </li>
            <li>
              <strong>Fastpris:</strong> du giver en fast pris for et defineret
              stykke arbejde. Uanset om det tager 10 eller 20 timer, er prisen
              den samme.
            </li>
          </ul>
          <p>
            Begge modeller har deres styrker. Kunsten er at vide hvorn&aring;r
            du skal bruge hvilken.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Klippekort: Fordele og ulemper
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">Fordele</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Forudsigelig indt&aelig;gt:</strong> du f&aring;r pengene
              f&oslash;r arbejdet udf&oslash;res, og du kan planl&aelig;gge din
              kapacitet
            </li>
            <li>
              <strong>Fleksibilitet:</strong> kunden kan bruge timerne til
              forskellige opgaver uden at forhandle en ny aftale hver gang
            </li>
            <li>
              <strong>Mindre besvær:</strong> &quot;kan du lige...&quot; bliver
              til et hurtigt tidsforbrug i stedet for et nyt tilbud
            </li>
            <li>
              <strong>Bedre kunderelation:</strong> l&oslash;bende samarbejde
              skaber dybere forst&aring;else af kundens forretning
            </li>
            <li>
              <strong>Genk&oslash;bsmotor:</strong> n&aring;r klippekortet er
              brugt op, k&oslash;ber kunden typisk et nyt
            </li>
          </ul>

          <h3 className="text-xl font-semibold text-slate-900">Ulemper</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Kunden b&aelig;rer risikoen:</strong> de betaler for timer
              de m&aring;ske ikke bruger
            </li>
            <li>
              <strong>Kr&aelig;ver tidsregistrering:</strong> du skal
              dokumentere hvad tiden g&aring;r til
            </li>
            <li>
              <strong>Sv&aelig;rere at s&aelig;lge:</strong> nogle kunder
              foretr&aelig;kker at vide pr&aelig;cis hvad de f&aring;r for
              pengene
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            Fastpris: Fordele og ulemper
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">Fordele</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Klar forventningsafstemning:</strong> b&aring;de du og
              kunden ved pr&aelig;cis hvad der skal leveres og hvad det koster
            </li>
            <li>
              <strong>Nemmere at s&aelig;lge:</strong> kunden kan sammenligne
              med andre tilbud og godkende et fast bel&oslash;b
            </li>
            <li>
              <strong>H&oslash;jere indtjening ved effektivitet:</strong>
              hvis du er hurtigere end estimeret, tjener du mere pr. time
            </li>
            <li>
              <strong>Passer til projektarbejde:</strong> nye websites,
              redesigns, migreringer med klart scope
            </li>
          </ul>

          <h3 className="text-xl font-semibold text-slate-900">Ulemper</h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Scope creep:</strong> &quot;kan vi ikke ogs&aring;
              lige...&quot; &aelig;der din fortjeneste
            </li>
            <li>
              <strong>Du b&aelig;rer risikoen:</strong> uforudsete problemer kan
              g&oslash;re projektet urentabelt
            </li>
            <li>
              <strong>Ingen l&oslash;bende indt&aelig;gt:</strong>
              n&aring;r projektet er leveret, stopper pengene
            </li>
            <li>
              <strong>Estimeringsusikkerhed:</strong> det er sv&aelig;rt at
              estimere pr&aelig;cist, s&aelig;rligt for komplekse opgaver
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvorn&aring;r skal du bruge hvad?
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">
            V&aelig;lg klippekort n&aring;r:
          </h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              Du har l&oslash;bende samarbejde med kunden (support, vedligehold,
              r&aring;dgivning)
            </li>
            <li>
              Opgaverne er varierede og sv&aelig;re at definere p&aring;
              forh&aring;nd
            </li>
            <li>
              Kunden har brug for hurtig respons uden at skulle igennem en
              tilbudsproces
            </li>
            <li>
              Du &oslash;nsker forudsigelig, tilbagevendende indt&aelig;gt
            </li>
          </ul>

          <h3 className="text-xl font-semibold text-slate-900">
            V&aelig;lg fastpris n&aring;r:
          </h3>
          <ul className="list-disc space-y-2 pl-6">
            <li>Projektet har et klart, afgr&aelig;nset scope</li>
            <li>
              Du har lavet lignende projekter f&oslash;r og kan estimere
              pr&aelig;cist
            </li>
            <li>
              Kunden kr&aelig;ver et fast budget (f.eks. ved offentlige udbud)
            </li>
            <li>
              Det er et engangsprojekt uden forventet l&oslash;bende samarbejde
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            Hybridmodellen: Det bedste fra begge verdener
          </h2>
          <p>
            Mange erfarne freelancere bruger en hybridmodel. Det ser typisk
            s&aring;dan ud:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Fastpris for det initiale projekt:</strong> f.eks. en ny
              hjemmeside for 45.000 kr med klart scope og leverancebeskrivelse
            </li>
            <li>
              <strong>Klippekort for den l&oslash;bende drift:</strong>
              efter lancering k&oslash;ber kunden et klippekort til
              &aelig;ndringer, opdateringer og support
            </li>
          </ul>
          <p>
            Denne model giver kunden tryghed ved det store projekt (de kender
            prisen) og dig en l&oslash;bende indt&aelig;gtsstr&oslash;m
            bagefter.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            S&aring;dan pitcher du klippekort til kunder
          </h2>
          <p>
            Mange kunder kender ikke konceptet. Her er tre argumenter der
            virker:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>
                &quot;Du slipper for at vente p&aring; tilbud&quot;:
              </strong>{" "}
              med et klippekort kan du bare skrive til mig, og jeg g&aring;r i
              gang. Ingen ventetid p&aring; at et tilbud skal godkendes.
            </li>
            <li>
              <strong>&quot;Du har fuldt overblik&quot;:</strong> du kan til
              enhver tid se hvor mange timer du har brugt, hvad de er g&aring;et
              til, og hvor mange der er tilbage.
            </li>
            <li>
              <strong>&quot;Det er billigere end ad hoc&quot;:</strong> du kan
              tilbyde en lille rabat (5-10%) p&aring; klippekortet sammenlignet
              med enkelttimer. Det motiverer kunden til at forpligte sig.
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            Overgang fra fastpris til klippekort
          </h2>
          <p>
            Hvis du i dag prim&aelig;rt arbejder med fastpris, kan du gradvist
            introducere klippekort:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Start med eksisterende kunder:</strong> de kender og
              stoler p&aring; dig allerede
            </li>
            <li>
              <strong>Tilbyd et sm&aring;t klippekort:</strong> 5 eller 10 timer
              er en lav risiko for kunden
            </li>
            <li>
              <strong>Vis v&aelig;rdien:</strong> efter f&oslash;rste
              klippekort, lav en kort opg&oslash;relse over hvad timerne gik
              til. Transparens skaber tillid.
            </li>
            <li>
              <strong>Brug det som upsell:</strong> &quot;vi er f&aelig;rdige
              med websitet. Skal vi lave et klippekort til l&oslash;bende
              &aelig;ndringer?&quot;
            </li>
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">Bundlinjen</h2>
          <p>
            Der er ikke &eacute;n rigtig model. De dygtigste freelancere bruger
            begge: fastpris n&aring;r scope er klart, klippekort n&aring;r
            samarbejdet er l&oslash;bende. Nøglen er at matche prismodellen med
            opgavens natur og kundens behov.
          </p>
          <p>
            Men &eacute;n ting er sikkert: klippekort giver bedre cashflow,
            f&aelig;rre fakturaforhandlinger og mere loyale kunder. Det er
            v&aelig;rd at pr&oslash;ve.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-slate-50 p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            Pr&oslash;v klippekort i TimeTrack
          </h2>
          <p className="mt-2 text-slate-600">
            Opret klippekort, registr&eacute;r tid og giv kunden adgang til
            overblikket i &eacute;t system.
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
                href="/blog/klippekort-freelancer"
                className="text-brand-600 hover:text-brand-700"
              >
                Klippekort til kunder: S&aring;dan s&aelig;lger du forudbetalte
                timer →
              </Link>
            </li>
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
