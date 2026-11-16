import Link from "next/link";
import { mk } from "@/components/marketing/mk";

/** /virksomheder: lovkravet og trygheden før founderen (BRAND.md §9.3). */
export function LovkravKort({ showLink = true }: { showLink?: boolean }) {
  const rows = [
    {
      krav: "Den daglige arbejdstid skal registreres",
      svar: "Check ind og ud, eller timer på kunder og projekter",
    },
    {
      krav: "Medarbejderen skal kunne se sine egne registreringer",
      svar: "Alle ser deres egne timer, saldi og godkendelser",
    },
    {
      krav: "Rettelser skal kunne dokumenteres",
      svar: "Hændelseslog over registreringer og rettelser",
    },
  ];
  return (
    <figure className={`${mk.card} p-6 sm:p-7`}>
      <figcaption className="font-semibold text-tt-blaek">
        Lov om registrering af arbejdstid, fra 1. juli 2024
      </figcaption>
      <dl className="mt-4">
        {rows.map((r) => (
          <div key={r.krav} className="border-t border-tt-streg py-3.5">
            <dt className="text-sm text-tt-graa">{r.krav}</dt>
            <dd className="mt-1 font-medium text-tt-blaek">{r.svar}</dd>
          </div>
        ))}
      </dl>
      {showLink ? (
        <p className="mt-2 border-t border-tt-streg pt-4 text-sm text-tt-graa">
          <Link href="/blog/tidsregistrering-lov-danmark" className={mk.link}>
            Læs om reglerne
          </Link>
        </p>
      ) : null}
    </figure>
  );
}
