import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Siden findes ikke",
  robots: { index: false, follow: true },
};

/**
 * 404 i brandets stil (docs/BRAND.md): én farve, venstrestillet, ingen
 * udråbstegn, forklar hvad der skete og hvad man kan gøre. Farverne kommer
 * fra --tt-* tokens, så siden følger lys/mørk.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center bg-tt-papir px-4 py-16 text-tt-blaek">
      <div className="mx-auto w-full max-w-xl">
        <Link
          href="/"
          aria-label={`${brand.name}, til forsiden`}
          className="rounded-lg"
        >
          <Logo size="lg" />
        </Link>

        <p className="mt-16 text-sm font-medium text-tt-graa">Fejl 404</p>
        <h1 className="mt-2 text-4xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
          Siden findes ikke
        </h1>
        <p className="mt-6 max-w-[60ch] text-lg leading-relaxed text-tt-graa">
          Adressen er måske skrevet forkert, eller siden er flyttet. Dine timer
          og kunder er ikke berørt. Gå til forsiden, eller åbn appen, hvis du er
          logget ind.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-tt-gran px-5 font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            Gå til forsiden
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-tt-kant px-5 font-medium hover:bg-tt-flade"
          >
            Åbn appen
          </Link>
        </div>

        <p className="mt-12 text-sm text-tt-graa">
          Mangler du noget, så{" "}
          <Link
            href="/contact"
            className="font-medium text-tt-gran underline underline-offset-4"
          >
            skriv til mig
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
