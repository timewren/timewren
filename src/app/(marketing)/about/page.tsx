import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { CTASection } from "@/components/marketing/CTASection";
import { CVR } from "@/components/marketing/FounderNote";
import { mk } from "@/components/marketing/mk";
import { Navigation } from "@/components/Navigation";
import { brand } from "@/lib/brand";

const DESCRIPTION =
  "TimeTrack er lavet og drevet af Mads Holst Jensen fra Odense. Hvorfor han byggede det, hvem der står bag, og hvad du kan regne med.";

export const metadata: Metadata = {
  title: "Om TimeTrack",
  description: DESCRIPTION,
  openGraph: { title: "Om TimeTrack", description: DESCRIPTION },
  alternates: { canonical: "/about" },
};

const LOEFTER = [
  {
    title: "Jeg svarer selv",
    text: "Skriver du til support, er det mig, der læser det og svarer.",
  },
  {
    title: "Dine data er dine",
    text: "Du kan altid hente alle dine data ud som én fil, også uden et betalt abonnement.",
    href: "/tillid#eksport",
    link: "Sådan virker eksporten",
  },
  {
    title: "Ingen overvågning",
    text: "TimeTrack tager ingen skærmbilleder og registrerer ikke, hvad du laver på computeren.",
    href: "/tillid#overvaagning",
    link: "Læs mere",
  },
  {
    title: "Varsel, hvis det en dag lukker",
    text: "Lukker TimeTrack, får du besked på mail mindst 6 måneder før, og du kan hente dine data hele perioden.",
    href: "/tillid#kontinuitet",
    link: "Hvad hvis Mads stopper?",
  },
];

export default function AboutPage() {
  return (
    <div className={mk.page}>
      <Navigation />

      <main>
        <section className="pt-28 pb-16 sm:pt-36 sm:pb-24">
          <div
            className={`${mk.wrap} grid items-start gap-12 md:grid-cols-[1fr_320px] lg:grid-cols-[1fr_400px] lg:gap-20 [&>*]:min-w-0`}
          >
            <div>
              <h1 className={mk.h1Small}>Om TimeTrack</h1>
              <div className={`${mk.lead} mt-8 max-w-2xl space-y-5`}>
                <p>
                  Jeg hedder Mads Holst Jensen. Jeg bygger og driver TimeTrack
                  fra Odense.
                </p>
                <p>
                  Jeg begyndte at bygge TimeTrack, da det timeværktøj, jeg selv
                  brugte, meldte, at det ville lukke. Da det senere blev købt og
                  fortsatte, var TimeTrack næsten færdigt, og jeg valgte at gøre
                  det færdigt.
                </p>
                <p>
                  Jeg er selv selvstændig og laver web og drift for kunder
                  gennem Mahoje. Mine egne timer registrerer jeg i TimeTrack, så
                  jeg mærker det selv, når noget er besværligt.
                </p>
              </div>
              <p className="mt-8 flex flex-wrap gap-3">
                <a
                  href={`mailto:${brand.contactEmail}`}
                  className={mk.btnPrimary}
                >
                  Skriv til {brand.contactEmail}
                </a>
                <a
                  href="https://mahoje.dk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={mk.btnSecondary}
                >
                  mahoje.dk
                </a>
              </p>
            </div>
            <Image
              src="/brand/mads-portraet.jpg"
              alt="Mads Holst Jensen"
              width={640}
              height={800}
              priority
              className="aspect-[4/5] w-full rounded-[4px] object-cover"
              sizes="(min-width: 1024px) 400px, (min-width: 768px) 320px, 100vw"
            />
          </div>
        </section>

        <section aria-labelledby="loefter-heading" className={mk.section}>
          <div
            className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`}
          >
            <h2 id="loefter-heading" className={mk.h2}>
              Det kan du regne med
            </h2>
            <dl className="border-t border-tt-streg">
              {LOEFTER.map((l) => (
                <div
                  key={l.title}
                  className="grid gap-1 border-b border-tt-streg py-5 sm:grid-cols-[220px_1fr] sm:gap-6"
                >
                  <dt className="font-semibold text-tt-blaek">{l.title}</dt>
                  <dd className={mk.body}>
                    {l.text}{" "}
                    {l.href ? (
                      <Link href={l.href} className={mk.link}>
                        {l.link}
                      </Link>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section aria-labelledby="firma-heading" className={mk.section}>
          <div
            className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`}
          >
            <h2 id="firma-heading" className={mk.h2}>
              Firmaet bag
            </h2>
            <div className={`${mk.body} max-w-2xl space-y-4`}>
              <p>
                TimeTrack er lavet af Mahoje v/ Mads Holst Jensen, CVR {CVR}.
                Firmaet er registreret som Mahope i CVR, og det navn står i de
                juridiske dokumenter.
              </p>
              <p>
                Databasen ligger hos Hetzner i Tyskland, og filer og backup hos
                Hetzner i Finland. Databehandleraftalen gælder for alle planer.{" "}
                <Link href="/tillid" className={mk.link}>
                  Tillid og data
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>

      <CTASection secondaryHref="/pricing" secondaryLabel="Se priser" />

      <Footer />
    </div>
  );
}
