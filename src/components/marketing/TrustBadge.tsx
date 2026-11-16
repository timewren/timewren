import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";

/**
 * Tillidspillen i heroen (docs/BRAND.md §4): ét sammenhængende, klikbart
 * badge til /tillid. Aldrig to spalter af tekst side om side (tidligere
 * PillBadge-opsætning brød linjen i to flex-kolonner på mobil) — her er
 * ikon og tekst ét flow, så det kun kan brydes som normal tekst.
 */
export function TrustBadge({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/tillid"
      className={`group inline-flex max-w-full items-center gap-2 rounded-full border border-tt-streg bg-tt-gran-lys px-3.5 py-1.5 text-[13px] font-medium text-tt-gran transition-colors hover:border-tt-gran/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tt-fokus sm:text-sm motion-reduce:transition-none ${className}`}
    >
      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>Dansk. Database og backup i EU.</span>
      <ArrowRight
        className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        aria-hidden="true"
      />
    </Link>
  );
}
