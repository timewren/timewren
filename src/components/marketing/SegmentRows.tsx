import Link from "next/link";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";
import type { SegmentSlug } from "@/lib/marketing/segments";

/**
 * Sporene med pris pr. spor (mockup docs/brand/forside.html, "Til den måde,
 * du arbejder på"). Bruges på forsiden og nederst på segmentsiderne.
 */
const SPOR: {
  slug: SegmentSlug;
  href: string;
  name: string;
  text: string;
  price: string;
  extra: string | null;
}[] = [
  {
    slug: "selvstaendig",
    href: "/selvstaendig",
    name: "Selvstændige",
    text: "Klippekort, fakturagrundlag og Billy eller Dinero.",
    price: PLAN_PRICES.selvstaendig.price,
    extra: PLAN_PRICES.selvstaendig.extra,
  },
  {
    slug: "teams-og-bureauer",
    href: "/teams-og-bureauer",
    name: "Små bureauer",
    text: "Fælles kunder, teamoverblik og timer i browseren, hvor folk arbejder.",
    price: PLAN_PRICES.team.price,
    extra: PLAN_PRICES.team.extra,
  },
  {
    slug: "virksomheder",
    href: "/virksomheder",
    name: "Virksomheder",
    text: "Registrering af arbejdstid efter loven, ferie, fravær, flex og løneksport.",
    price: PLAN_PRICES.virksomhed.price,
    extra: PLAN_PRICES.virksomhed.extra,
  },
  {
    slug: "privat",
    href: "/privat",
    name: "Privat",
    text: `Studier, sideprojekter og foreninger. Gratis: ${PLAN_PRICES.gratis.includes}.`,
    price: `0 kr. eller ${PLAN_PRICES.privat.price}`,
    extra: PLAN_PRICES.privat.extra,
  },
];

export function SegmentRows({
  exclude,
  className = "",
}: {
  exclude?: SegmentSlug;
  className?: string;
}) {
  return (
    <ul className={`border-t border-tt-streg ${className}`}>
      {SPOR.filter((s) => s.slug !== exclude).map((s) => (
        <li key={s.href}>
          <Link
            href={s.href}
            className="group grid gap-1 border-b border-tt-streg py-6 sm:grid-cols-[200px_1fr_auto] sm:items-baseline sm:gap-6"
          >
            <span className="text-xl font-bold tracking-[-0.015em] text-tt-blaek group-hover:text-tt-gran">
              {s.name}
            </span>
            <span className="text-tt-graa">{s.text}</span>
            <span className="sm:text-right">
              <span className="font-semibold text-tt-blaek">{s.price}</span>
              {s.extra ? (
                <span className="block text-sm text-tt-graa">{s.extra}</span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
