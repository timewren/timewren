import { ArrowRight, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { ContactForm } from "@/components/forms/ContactForm";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";
import { TRPCProvider } from "@/providers/trpc-provider";

export const metadata: Metadata = {
  title: "Kontakt",
  description:
    "Kontakt TimeTrack: skriv til timetrack@timetrack.dk eller send en besked via formularen. Jeg svarer typisk inden for 24 timer.",
  openGraph: {
    title: "Kontakt",
    description:
      "Kontakt TimeTrack: skriv til timetrack@timetrack.dk eller send en besked via formularen. Jeg svarer typisk inden for 24 timer.",
  },
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "TimeTrack",
    url: "https://timetrack.dk",
    email: "timetrack@timetrack.dk",
    identifier: "CVR 39413892",
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "timetrack@timetrack.dk",
        availableLanguage: ["da"],
      },
    ],
  };

  return (
    <div className="min-h-screen bg-white">
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: statisk JSON-LD
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
      />
      <Navigation />

      <MarketingHero
        title="Kontakt mig"
        subtitle="Har du spørgsmål om TimeTrack, timeregistrering, klippekort eller fakturagrundlag? Send en besked, så svarer jeg typisk inden for 24 timer."
      >
        <p className="mt-4 text-base text-slate-500">
          Det hurtigste er at skrive til{" "}
          <a
            className="font-medium text-brand-700 hover:text-brand-800"
            href="mailto:timetrack@timetrack.dk"
          >
            timetrack@timetrack.dk
          </a>
          .
        </p>
      </MarketingHero>

      {/* Contact Section */}
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-12 lg:grid-cols-3">
            {/* Contact Info */}
            <div className="lg:col-span-1">
              <h2 className="mb-6 text-2xl font-bold text-slate-900">
                Kontakt Information
              </h2>
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100">
                    <Mail className="h-6 w-6 text-brand-600" />
                  </div>
                  <div>
                    <h3 className="mb-1 font-semibold text-slate-900">Email</h3>
                    <a
                      href="mailto:timetrack@timetrack.dk"
                      className="text-brand-600 hover:text-brand-700"
                    >
                      timetrack@timetrack.dk
                    </a>
                    <p className="mt-1 text-sm text-slate-600">
                      Jeg svarer typisk inden for 24 timer
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-8 rounded-2xl border border-brand-200/60 bg-brand-50 p-6">
                <h3 className="mb-2 font-semibold text-slate-900">Info</h3>
                <dl className="space-y-2 text-sm text-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-600">CVR</dt>
                    <dd className="font-medium">39413892</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-600">Svar-tid</dt>
                    <dd className="font-medium">Typisk inden for 24 timer</dd>
                  </div>
                </dl>
              </div>
            </div>

            {/* Contact Form */}
            <div className="lg:col-span-2">
              <div className="rounded-2xl border border-slate-200/60 bg-white p-8 shadow-sm">
                <h2 className="mb-6 text-2xl font-bold text-slate-900">
                  Send mig en besked
                </h2>
                <TRPCProvider>
                  <ContactForm />
                </TRPCProvider>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What We Can Help With */}
      <section className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-4 text-center text-3xl font-bold text-slate-900">
            Hvad kan jeg hjælpe dig med?
          </h2>
          <p className="mb-12 text-center text-lg text-slate-600">
            Uanset om du er ny bruger eller erfaren freelancer, står jeg klar
            til at hjælpe dig med at få mest muligt ud af TimeTrack.
          </p>
          <div className="grid gap-8 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Kom godt i gang
              </h3>
              <p className="text-slate-600">
                Har du brug for hjælp til at oprette din konto, importere data
                fra andre systemer eller konfigurere klippekort og
                timeregistrering? Jeg guider dig igennem hele processen.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Integrationer
              </h3>
              <p className="text-slate-600">
                Jeg hjælper med opsætning af integrationer til{" "}
                <a
                  href="https://www.billy.dk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 hover:text-brand-700"
                >
                  Billy
                </a>
                ,{" "}
                <a
                  href="https://www.dinero.dk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 hover:text-brand-700"
                >
                  Dinero
                </a>{" "}
                og andre bogføringssystemer, så din fakturering kører
                automatisk.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Fejlrapportering
              </h3>
              <p className="text-slate-600">
                Oplever du tekniske problemer eller fejl i systemet? Send mig en
                detaljeret beskrivelse, og jeg kigger på det hurtigst muligt.
                Inkluder gerne skærmbilleder hvis muligt.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6">
              <h3 className="mb-2 text-lg font-semibold text-slate-900">
                Feedback og forslag
              </h3>
              <p className="text-slate-600">
                Din feedback er vigtig for mig. TimeTrack er bygget til danske
                freelancere, og jeg udvikler løbende nye funktioner baseret på
                brugernes ønsker og behov. Del dine ideer med mig.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Prompt Section */}
      <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="mb-4 text-3xl font-bold text-slate-900">
            Ofte stillede spørgsmål
          </h2>
          <p className="mb-8 text-lg text-slate-600">
            Mange spørgsmål er allerede besvaret i FAQ&apos;en, især om
            klippekort, timeregistrering, fakturagrundlag og integration med
            danske bogføringssystemer som Billy, Dinero og e-conomic.
          </p>
          <Link
            href="/faq"
            className="inline-flex items-center gap-2 rounded-xl border-2 border-brand-600 bg-white px-8 py-3 font-semibold text-brand-600 transition-colors hover:bg-brand-50"
          >
            Se FAQ
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
