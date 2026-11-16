import Image from "next/image";

/** Rigtige skærmbilleder (lokal testdata, opdigtede kunder). */
const DESKTOP = {
  src: "/screenshots/marketing/ugeoversigt.webp",
  width: 1600,
  height: 818,
  alt: "Ugeoversigten i TimeTrack med timer pr. projekt og dag for en uge.",
};

const TELEFON = {
  src: "/screenshots/marketing/kundeportal-klippekort.webp",
  width: 716,
  height: 828,
  alt: "Kundeportalen viser klippekortet med timer tilbage og posteringer.",
};

/**
 * Appen i brug, lagdelt: ugeoversigten i en browserramme med ro over sig,
 * og kundeportalen på telefon foran i hjørnet. Begge er rigtige
 * skærmbilleder fra appen (ikke stockfoto eller mockup).
 */
export function ProductShowcase() {
  return (
    <figure className="relative pb-12 sm:pb-16">
      <div className="overflow-hidden rounded-[14px] border border-tt-streg bg-tt-flade shadow-[0_28px_60px_-32px_rgba(26,29,28,0.35)]">
        <div
          aria-hidden="true"
          className="flex items-center gap-1.5 border-b border-tt-streg bg-tt-papir px-4 py-3"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-tt-kant/35" />
          <span className="h-2.5 w-2.5 rounded-full bg-tt-kant/35" />
          <span className="h-2.5 w-2.5 rounded-full bg-tt-kant/35" />
        </div>
        <Image
          src={DESKTOP.src}
          width={DESKTOP.width}
          height={DESKTOP.height}
          alt={DESKTOP.alt}
          className="h-auto w-full"
          sizes="(min-width: 1024px) 760px, 100vw"
        />
      </div>

      <div className="absolute right-2 bottom-0 w-[128px] overflow-hidden rounded-[20px] border-[5px] border-tt-blaek bg-tt-blaek shadow-[0_20px_40px_-20px_rgba(26,29,28,0.5)] sm:right-6 sm:w-[160px]">
        <Image
          src={TELEFON.src}
          width={TELEFON.width}
          height={TELEFON.height}
          alt={TELEFON.alt}
          className="h-auto w-full"
          sizes="160px"
        />
      </div>

      <figcaption className="mt-5 text-[13px] text-tt-graa">
        Skærmbilleder af ugeoversigten og kundeportalen med opdigtede testdata.
      </figcaption>
    </figure>
  );
}
