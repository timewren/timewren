import { ClipboardList, Hammer, MessageSquareText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";

const TITLE = "Timeregistrering for håndværkere: fra timeseddel til faktura";
const DESCRIPTION =
  "Enkel timeregistrering til små håndværksvirksomheder: timer pr. kunde og opgave fra telefonen, regningsarbejde med dokumentation, tilbud vs. faktisk tid og faktura via Billy eller Dinero. Gratis for 3 brugere.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "timeregistrering håndværker",
    "tidsregistrering håndværker",
    "timeseddel håndværker",
    "håndværker app",
    "regningsarbejde",
  ],
  alternates: { canonical: "/timeregistrering-haandvaerker" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/timeregistrering-haandvaerker",
    type: "website",
  },
};

const FAQ = [
  {
    question: "Er TimeTrack et ordrestyringssystem?",
    answer:
      "Nej. TimeTrack har ikke materialestyring, varekataloger, fotodokumentation eller kvalitetssikring. Har du brug for det, er et ordrestyringssystem som Ordrestyring, Minuba eller Apacta et bedre valg. TimeTrack passer til den lille virksomhed, der primært skal have timerne registreret og faktureret uden papir og SMS’er.",
  },
  {
    question: "Hvad koster det for et lille firma?",
    answer:
      "Gratis dækker op til 3 brugere og 3 aktive kunder. Har du flere kunder, koster Selvstændig 79 kr. om måneden for én bruger, og Team 49 kr. pr. bruger om måneden. Der er intet oprettelsesgebyr.",
  },
  {
    question: "Skal mine ansattes arbejdstid registreres?",
    answer:
      "Ja. Siden 1. juli 2024 skal arbejdsgivere i Danmark have et system, der registrerer de ansattes daglige arbejdstid. Planen Virksomhed (69 kr. pr. bruger om måneden) har check ind og ud, ferie, fravær og overtid. Til ren timeregistrering pr. kunde er Team nok.",
  },
  {
    question: "Kan svenden registrere fra telefonen?",
    answer:
      "Ja. TimeTrack virker i mobilens browser og kan lægges på hjemmeskærmen som en app. Apps til iPhone og Android er i test og kommer i App Store og Google Play. Man kan starte en timer eller skrive fx “3 timer badeværelse Hansen i dag”.",
  },
  {
    question: "Hvordan dokumenterer jeg regningsarbejde?",
    answer:
      "Registrér tiden på opgaven med en kort beskrivelse hver dag. Fakturagrundlaget samler timerne med dato og tekst, så kunden kan se, hvad der er lavet, og du har dokumentationen, hvis der kommer spørgsmål til regningen.",
  },
];

const PAINS = [
  {
    icon: ClipboardList,
    title: "Timesedler på papir og i SMS’er",
    text: "Svenden skriver timer på en seddel i bilen eller sender en SMS fredag. Mandag skal nogen tyde det, fordele det på kunder og taste det ind. Det koster tid og giver fejl.",
  },
  {
    icon: MessageSquareText,
    title: "“Når du nu alligevel er her…”",
    text: "Ekstraopgaver på en tilbudsopgave er klassikeren. Bliver de ikke skrevet ned som ekstraarbejde med det samme, ender de gratis inde i tilbudsprisen.",
  },
  {
    icon: Hammer,
    title: "Tilbud uden efterkalkulation",
    text: "Du giver fast pris på et badeværelse. Men holdt timerne? Uden tid på opgaven gætter du igen på det næste tilbud, og det samme hul gentager sig.",
  },
];

export default function TimeregistreringHaandvaerkerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <SEOPageLayout
      badge="Til håndværkere"
      title="Timeregistrering for håndværkere"
      subtitle="Til den lille håndværksvirksomhed: timer pr. kunde og opgave fra telefonen, regningsarbejde med dokumentation og faktura i Billy eller Dinero. Gratis for op til 3 brugere."
      jsonLd={faqSchema}
      faqItems={FAQ.map((f) => ({
        question: f.question,
        answer: <p>{f.answer}</p>,
      }))}
      relatedLinks={[
        {
          href: "/timeseddel-skabelon",
          title: "Timeseddel-skabelon",
          description:
            "Gratis timeseddel i Excel, hvis du ikke er klar til en app.",
        },
        {
          href: "/timepris-haandvaerker",
          title: "Timepris for håndværkere",
          description: "Regn timeprisen ud fra løn og fakturerbare timer.",
        },
        {
          href: "/virksomheder",
          title: "Lovpligtig tidsregistrering",
          description: "Check ind og ud, ferie og fravær for ansatte.",
        },
      ]}
      ctaTitle="Smid timesedlerne ud"
      ctaSubtitle="Gratis for op til 3 brugere og 3 kunder. Intet betalingskort."
    >
      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Her forsvinder håndværkerens timer
          </h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {PAINS.map((p) => (
              <div
                key={p.title}
                className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm"
              >
                <p.icon
                  className="mb-4 h-8 w-8 text-brand-600"
                  aria-hidden="true"
                />
                <h3 className="mb-2 text-xl font-semibold text-slate-900">
                  {p.title}
                </h3>
                <p className="text-slate-600">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Sådan bruger en lille tømrervirksomhed det
          </h2>
          <ol className="list-decimal space-y-3 pl-6">
            <li>
              <strong>Kunden oprettes</strong>, privat eller med CVR-opslag for
              erhvervskunder.
            </li>
            <li>
              <strong>Hver opgave er et projekt</strong>: “Badeværelse, Hansen”
              får den faste tilbudspris og et timebudget. “Udskiftning af
              vinduer, Jensen” er regningsarbejde med timepris.
            </li>
            <li>
              <strong>Ekstraarbejde får sit eget projekt</strong>, “Hansen,
              ekstra”, så det ikke drukner i tilbudsprisen.
            </li>
            <li>
              <strong>Svenden registrerer fra telefonen</strong> med en timer
              eller fritekst. Mester ser timerne samme dag, ikke fredag.
            </li>
            <li>
              <strong>Faktura</strong>: regningsarbejdet samles med dato og
              beskrivelse og sendes til{" "}
              <Link href="/billy" className="text-brand-600 underline">
                Billy
              </Link>{" "}
              eller{" "}
              <Link href="/dinero" className="text-brand-600 underline">
                Dinero
              </Link>
              . Til{" "}
              <Link href="/e-conomic" className="text-brand-600 underline">
                e-conomic
              </Link>{" "}
              er der integration og fakturagrundlag. Materialer lægger du på i
              regnskabsprogrammet.
            </li>
          </ol>
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Eksempel: holdt tilbuddet?
          </h2>
          <p>
            Et badeværelse er solgt til fast pris. Arbejdslønnen i tilbuddet er
            25.000 kr. ekskl. moms, regnet ud fra 48 timer. Det svarer til 521
            kr. i timen.
          </p>
          <p>
            Med tiden registreret på opgaven viser det sig, at den tog 61 timer,
            fordi gulvet skulle rettes op. Den reelle timepris endte på 410 kr.
            Det er ikke en katastrofe én gang, men sker det på hvert tredje
            badeværelse, er det en fejl i kalkulen. Næste tilbud kan regnes med
            et tillæg for gamle gulve, eller gulvet kan tages som ekstraarbejde.
          </p>
          <p>
            Timebudgettet på projektet viser forbruget undervejs, så du kan tage
            snakken med kunden om ekstraarbejde, mens du stadig er på pladsen.
          </p>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Hvad TimeTrack ikke er
          </h2>
          <p>
            TimeTrack er timeregistrering og fakturering, ikke ordrestyring. Der
            er ingen materialestyring, ingen varekataloger fra grossister, ingen
            fotodokumentation og ingen KLS. Har du brug for det, er et
            ordrestyringssystem som Ordrestyring, Minuba eller Apacta et bedre
            valg, selv om det koster mere.
          </p>
          <p>
            TimeTrack passer, når I er få mand, materialerne allerede håndteres
            i regnskabsprogrammet, og det, der mangler, er at få timerne fra
            byggepladsen til fakturaen uden papir. Har du ansatte, skal deres
            arbejdstid desuden registreres efter reglerne fra 1. juli 2024. Det
            klarer planen{" "}
            <Link href="/virksomheder" className="text-brand-600 underline">
              Virksomhed
            </Link>{" "}
            med check ind og ud.
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
