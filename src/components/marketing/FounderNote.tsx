import Image from "next/image";
import Link from "next/link";

/** CVR 39413892 (Mahope/Mahoje v/ Mads Holst Jensen), jf. KONTRAKT og /tillid. */
export const CVR = "39413892";

const tillidLink = (
  <Link
    href="/tillid"
    className="font-medium text-tt-gran underline decoration-tt-gran/40 underline-offset-2 hover:decoration-tt-gran"
  >
    Læs om tillid og data
  </Link>
);

/**
 * Afsenderkortet (docs/BRAND.md §4): lille portræt i farver, navn og rolle,
 * én menneskelig sætning, og trygheden (CVR, database og backup i EU,
 * /tillid) som scanbare facts i stedet for én lang løbetekst.
 *
 * `variant="nedtonet"` bruges på /virksomheder, hvor trygheden leder og
 * founderen træder tilbage (BRAND.md §9, punkt 3).
 */
export function FounderNote({
  variant = "standard",
  className = "",
}: {
  variant?: "standard" | "nedtonet";
  className?: string;
}) {
  if (variant === "nedtonet") {
    return (
      <p className={`text-sm leading-relaxed text-tt-graa ${className}`}>
        TimeTrack drives af Mads Holst Jensen fra Danmark. CVR {CVR}. Database
        og backup i EU. {tillidLink}
      </p>
    );
  }

  return (
    <div
      className={`flex items-start gap-4 rounded-[14px] bg-tt-flade p-4 sm:gap-5 sm:p-5 ${className}`}
    >
      <Image
        src="/brand/mads-160.jpg"
        alt=""
        width={56}
        height={56}
        className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-tt-gran"
      />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-tt-blaek">
          Mads Holst Jensen
          <span className="font-normal text-tt-graa">, stifter</span>
        </p>
        <p className="mt-1 text-[15px] leading-relaxed text-tt-graa">
          Jeg bygger TimeTrack i Danmark og svarer selv på support.
        </p>
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-tt-graa">
          <li>CVR {CVR}</li>
          <li>Database og backup i EU</li>
          <li>{tillidLink}</li>
        </ul>
      </div>
    </div>
  );
}
