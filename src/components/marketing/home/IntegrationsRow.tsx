import Link from "next/link";
import { mk } from "@/components/marketing/mk";

/**
 * Regnskabsintegrationerne som en rolig tekstrække (ingen logofiler findes
 * i repoet for nogen af de tre, så alle vises som wordmarks, ikke logoer).
 */
export function IntegrationsRow({ className = "" }: { className?: string }) {
  return (
    <div className={`border-t border-tt-streg pt-10 ${className}`}>
      <p className={`${mk.fine} max-w-2xl`}>
        Forbindes med Billy, Dinero og e-conomic, og med Google Kalender,
        Zapier, Make og n8n.{" "}
        <Link href="/integrations" className={mk.link}>
          Se alle integrationer
        </Link>
      </p>
      <ul className="mt-5 flex flex-wrap items-center gap-x-10 gap-y-3">
        <li>
          <Link
            href="/billy"
            className="text-xl font-bold tracking-[-0.01em] text-tt-blaek/55 transition-colors hover:text-tt-gran"
          >
            Billy
          </Link>
        </li>
        <li>
          <Link
            href="/dinero"
            className="text-xl font-bold tracking-[-0.01em] text-tt-blaek/55 transition-colors hover:text-tt-gran"
          >
            Dinero
          </Link>
        </li>
        <li>
          <Link
            href="/integrations/economic"
            className="text-xl font-bold tracking-[-0.01em] text-tt-blaek/55 transition-colors hover:text-tt-gran"
          >
            e-conomic
          </Link>
        </li>
      </ul>
    </div>
  );
}
