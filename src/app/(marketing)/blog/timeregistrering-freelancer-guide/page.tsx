import { ArrowRight, Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";

export const metadata: Metadata = {
  title: "Timeregistrering som freelancer: Den komplette guide (2026)",
  description:
    "Lær hvordan du holder styr på dine timer som freelancer. Fra Excel til automatisk registrering: undgå tabte indtægter og fakturér korrekt hver gang.",
  openGraph: {
    title: "Timeregistrering som freelancer: Den komplette guide (2026)",
    description:
      "Lær hvordan du holder styr på dine timer som freelancer. Fra Excel til automatisk registrering: undgå tabte indtægter og fakturér korrekt.",
  },
  alternates: { canonical: "/blog/timeregistrering-freelancer-guide" },
};

export default function TimeregistreringFreelancerGuide() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: "Timeregistrering som freelancer: Den komplette guide (2026)",
    description:
      "Lær hvordan du holder styr på dine timer som freelancer. Fra Excel til automatisk registrering.",
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
    datePublished: "2026-05-23",
    dateModified: "2026-05-23",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": "https://timetrack.dk/blog/timeregistrering-freelancer-guide",
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
            Timeregistrering som freelancer: Den komplette guide
          </h1>
          <p className="mt-4 text-lg text-slate-600">
            Fra Excel til automatisk registrering: lær hvordan du holder styr på
            dine timer, undgår tabte indtægter og fakturerer korrekt.
          </p>
          <div className="mt-4 flex items-center gap-4 text-sm text-slate-500">
            <span>Af Mads Holst Jensen</span>
            <span>23. maj 2026</span>
            <span>8 min læsetid</span>
          </div>
        </header>

        <div className="prose-article mt-12 space-y-8 text-slate-700 leading-relaxed">
          <h2 className="text-2xl font-bold text-slate-900">
            Hvorfor timeregistrering er afgørende som freelancer
          </h2>
          <p>
            Som freelancer er din tid dit produkt. Hver time du glemmer at
            registrere er en time du ikke fakturerer. Og det sker oftere end du
            tror.
          </p>
          <p>
            En undersøgelse fra Freelancers Union viser at selvstændige i
            gennemsnit taber <strong>10-15% af deres fakturerbare tid</strong>{" "}
            på grund af manglende eller upræcis tidsregistrering. For en
            freelancer der fakturerer 100 timer om måneden til 800 kr/t, er det{" "}
            <strong>8.000-12.000 kr i tabt indtægt hver måned</strong>.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            De 3 mest udbredte metoder (og deres problemer)
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">
            1. Excel / Google Sheets
          </h3>
          <p>
            Den klassiske tilgang. Du opretter et ark med kolonner for dato,
            kunde, projekt, timer og beskrivelse. Det virker i starten.
          </p>
          <p>
            <strong>Problemet:</strong> Du skal huske at åbne arket, taste ind,
            og formatere det til fakturering. De fleste dropper det efter 2-3
            uger, og så er du tilbage til at estimere.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            2. Post-its og hukommelse
          </h3>
          <p>
            &quot;Jeg husker det nok.&quot; Nej. Det gør du ikke. Især ikke de
            15 minutter du brugte på et hurtigt opkald eller den email der tog
            45 minutter i stedet for 10.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            3. Dedikeret tidsregistrering
          </h3>
          <p>
            Et værktøj der er bygget til formålet. Start/stop timer, manuel
            registrering, rapporter og eksport til fakturering. Det er den
            metode der faktisk holder, fordi den er nem nok til at du gider
            bruge den.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Hvad et godt tidsregistreringsværktøj skal kunne
          </h2>
          <ul className="space-y-3">
            {[
              "Start/stop timer med ét klik, ellers bruger du det ikke",
              "Organisering pr. kunde og projekt, så rapporten giver mening",
              "Klippekort til kunder med faste aftaler",
              "Rapporter du kan sende direkte til kunden",
              "Eksport til dit regnskabsprogram (Billy, Dinero, e-conomic)",
              "Mobilvenlig, fordi du ikke altid registrerer fra en computer",
            ].map((item) => (
              <li key={item} className="flex gap-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <h2 className="text-2xl font-bold text-slate-900">
            Trin-for-trin: Kom i gang med tidsregistrering
          </h2>

          <h3 className="text-xl font-semibold text-slate-900">
            Trin 1: Opret dine kunder
          </h3>
          <p>
            Start med dine 2-3 vigtigste kunder. Du behøver ikke importere alle
            på dag 1. Tilføj kunde-navn, email og eventuelt CVR-nummer (det
            bruges til fakturering senere).
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            Trin 2: Opret et projekt pr. opgavetype
          </h3>
          <p>
            For hver kunde opretter du et projekt. Det kan være
            &quot;Hjemmeside&quot;, &quot;Drift&quot;, &quot;Rådgivning&quot;
            eller hvad der giver mening for dig. Hvert projekt har sin egen
            timesats.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            Trin 3: Brug timeren
          </h3>
          <p>
            Når du sætter dig for at arbejde, tryk &quot;Start&quot;. Når du er
            færdig, tryk &quot;Stop&quot;. Det er det hele. Timeren registrerer
            automatisk varigheden og tilknytter den til kunden/projektet.
          </p>

          <h3 className="text-xl font-semibold text-slate-900">
            Trin 4: Gennemse og fakturér ugentligt
          </h3>
          <p>
            Hver fredag bruger du 5 minutter på at gennemse ugens
            registreringer. Tjek at alt er med, juster eventuelle tider, og
            eksportér til dit regnskabsprogram.
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Bonus: Klippekort til faste kunder
          </h2>
          <p>
            Hvis du har kunder med løbende aftaler (drift, support, rådgivning),
            kan du sælge et klippekort: kunden køber f.eks. 20 timer på forhånd,
            og du trækker fra efterhånden som du arbejder.
          </p>
          <p>
            Det giver dig forudsigelig indtægt og kunden overblik over
            forbruget. Win-win.
          </p>
          <p>
            <Link
              href="/klippekort"
              className="text-brand-600 hover:text-brand-700 underline"
            >
              Læs mere om klippekort →
            </Link>
          </p>

          <h2 className="text-2xl font-bold text-slate-900">
            Den vigtigste regel
          </h2>
          <p>
            Det bedste system er det system du faktisk bruger. Hvis det kræver
            mere end 2 klik at registrere en time, er det for besværligt. Vælg
            et værktøj der passer til din hverdag, og brug det konsekvent.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-16 rounded-2xl bg-slate-50 p-8 text-center">
          <h2 className="text-2xl font-bold text-slate-900">
            Start gratis med TimeTrack
          </h2>
          <p className="mt-2 text-slate-600">
            Timeregistrering, klippekort og rapporter til danske freelancere.
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
                href="/blog/klippekort-freelancer"
                className="text-brand-600 hover:text-brand-700"
              >
                Klippekort til kunder: Sådan sælger du forudbetalte timer →
              </Link>
            </li>
            <li>
              <Link
                href="/timeregistrering-til-faktura"
                className="text-brand-600 hover:text-brand-700"
              >
                Fra timeregistrering til faktura →
              </Link>
            </li>
            <li>
              <Link
                href="/billy"
                className="text-brand-600 hover:text-brand-700"
              >
                Billy + TimeTrack integration →
              </Link>
            </li>
          </ul>
        </div>
      </article>

      <Footer />
    </div>
  );
}
