import { CreditCard, ShieldCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { KlippekortPrisBeregner } from "@/components/marketing/KlippekortPrisBeregner";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";

export const metadata: Metadata = {
  title: "Klippekort-prisberegner: hvad skal din timepakke koste?",
  description:
    "Gratis klippekort-beregner for freelancere og konsulenter: find den rigtige pris og rabat på din 5/10/20-timers pakke, se effektiv timepris og kundens besparelse.",
  alternates: { canonical: "/klippekort-prisberegner" },
  openGraph: {
    title: "Klippekort-prisberegner: hvad skal din timepakke koste?",
    description:
      "Find den rigtige pris og rabat på din timepakke. Se effektiv timepris og kundens besparelse.",
    url: "/klippekort-prisberegner",
    type: "website",
    images: [
      {
        url: "/api/og?badge=Gratis%20beregner&title=Klippekort-prisberegner&subtitle=Hvad%20skal%20din%20timepakke%20koste%3F",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: [
      "/api/og?badge=Gratis%20beregner&title=Klippekort-prisberegner&subtitle=Hvad%20skal%20din%20timepakke%20koste%3F",
    ],
  },
};

export default function KlippekortPrisBeregnerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Hvor stor rabat skal jeg give på et klippekort?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "En tommelfingerregel er 5% på små pakker (5 timer), 10% på mellemstore (10 timer) og op til 15% på store pakker (20+ timer). Rabatten modsvares af forudbetalingen: bedre likviditet, ingen debitor-risiko og en committet kunde.",
        },
      },
      {
        "@type": "Question",
        name: "Hvorfor sælge klippekort som freelancer?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Du får pengene på forhånd, slipper for rykkere, og kunden har allerede besluttet sig for at bruge dig. Klippekort udjævner også indtægten mellem store projekter.",
        },
      },
      {
        "@type": "Question",
        name: "Hvordan holder jeg styr på klippekort-saldoen?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Manuel saldo i et regneark skrider næsten altid. TimeTrack trækker automatisk registrerede timer fra kundens klippekort og advarer når saldoen er lav, så genkøbet kommer af sig selv.",
        },
      },
      {
        "@type": "Question",
        name: "Skal klippekort-timer have udløbsdato?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Ja, typisk 6-12 måneder. Uden udløb hænger gamle forpligtelser over dig for evigt. Skriv udløbet tydeligt i aftalen, og mind kunden om saldoen inden.",
        },
      },
    ],
  };

  const faqItems = [
    {
      question: "Hvor stor rabat skal jeg give på et klippekort?",
      answer: (
        <p>
          Tommelfingerregel: 5% på 5 timer, 10% på 10 timer, op til 15% på 20+
          timer. Rabatten er betaling for forudbetalingen: likviditet, ingen
          rykkere og en kunde, der har forpligtet sig.
        </p>
      ),
    },
    {
      question: "Hvorfor sælge klippekort som freelancer?",
      answer: (
        <p>
          Pengene kommer på forhånd, og kunden har allerede besluttet sig for at
          bruge dig. Læs mere:{" "}
          <Link className="underline" href="/blog/klippekort-freelancer">
            klippekort for freelancere
          </Link>
          .
        </p>
      ),
    },
    {
      question: "Hvordan holder jeg styr på saldoen?",
      answer: (
        <p>
          Regneark skrider. TimeTrack trækker automatisk registrerede timer fra
          kundens{" "}
          <Link className="underline" href="/klippekort">
            klippekort
          </Link>{" "}
          og advarer ved lav saldo.
        </p>
      ),
    },
    {
      question: "Skal timerne have udløbsdato?",
      answer: (
        <p>
          Ja, typisk 6-12 måneder, ellers hænger gamle forpligtelser over dig
          for evigt.
        </p>
      ),
    },
  ];

  return (
    <SEOPageLayout
      badge="Gratis værktøj"
      title="Klippekort-prisberegner"
      subtitle="Hvad skal din 5-, 10- eller 20-timers pakke koste? Find prisen, rabatten og salgsargumentet på 30 sekunder."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={[
        {
          href: "/klippekort",
          title: "Klippekort i TimeTrack",
          description: "Automatisk saldo, lav-saldo-advarsler og genkøb.",
        },
        {
          href: "/timepris-beregner",
          title: "Timepris-beregner",
          description: "Find din rigtige timepris først.",
        },
        {
          href: "/blog/klippekort-vs-fastpris",
          title: "Klippekort vs. fastpris",
          description: "Hvornår er hvad den rigtige model?",
        },
      ]}
      ctaTitle="Sælg dit første klippekort med automatisk saldo"
      ctaSubtitle="TimeTrack trækker timerne fra pakken automatisk. Gratis at starte."
    >
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <ToolUsageTracker tool="klippekort-prisberegner">
            <KlippekortPrisBeregner />
          </ToolUsageTracker>
          <ToolLeadCapture tool="klippekort-prisberegner" />
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Tre grunde til at prissætte pakken rigtigt
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <Wallet className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Likviditet nu
              </h3>
              <p className="text-slate-600">
                Forudbetaling flytter pengene fra "om 30 dage, måske efter en
                rykker" til i dag. Det er rabatten værd.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <ShieldCheck className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Ingen debitor-risiko
              </h3>
              <p className="text-slate-600">
                Betalte timer kan ikke ende som tab. For stor rabat æder dog
                gevinsten, så brug beregnerens tommelfingerregel.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <CreditCard className="mb-4 h-8 w-8 text-brand-600" />
              <h3 className="mb-2 text-xl font-semibold text-slate-900">
                Genkøb af sig selv
              </h3>
              <p className="text-slate-600">
                Med automatisk saldo og lav-saldo-advarsel bliver "skal vi fylde
                op?" en naturlig besked og ikke en akavet salgssamtale.
              </p>
            </div>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
