import Image from "next/image";

/**
 * Rigtige skærmbilleder fra appen (docs/BRAND.md → Fotografi og billeder),
 * taget af den lokale app med opdigtede testkunder. Mål står her, så der
 * ikke opstår layout-skift. Tages om, når app, portal og extension har fået
 * det nye udseende (issue #825 fase 3 og 6).
 */
export const SHOTS = {
  portal: {
    src: "/screenshots/marketing/kundeportal-klippekort.webp",
    width: 716,
    height: 828,
    alt: "Kundeportalen viser klippekortet med 7 timer tilbage af 20 og forbruget pr. registrering.",
  },
  uge: {
    src: "/screenshots/marketing/ugeoversigt.webp",
    width: 1600,
    height: 818,
    alt: "Ugeoversigten i TimeTrack med timer pr. projekt og dag for en uge.",
  },
  team: {
    src: "/screenshots/marketing/teamoverblik.webp",
    width: 1600,
    height: 354,
    alt: "Teamoverblikket med timer pr. medarbejder og dag for en uge.",
  },
  extension: {
    src: "/screenshots/extension/popup-dashboard.png",
    width: 400,
    height: 600,
    alt: "Browserudvidelsen med timeren og de seneste registreringer.",
  },
} as const;

export type ShotKey = keyof typeof SHOTS;

export function Shot({
  shot,
  caption,
  framed = false,
  maxWidth,
  priority = false,
  className = "",
}: {
  shot: (typeof SHOTS)[ShotKey];
  caption: string;
  /** Lille skærmbillede på en grå flade (portal-kort, extension). */
  framed?: boolean;
  maxWidth?: number;
  priority?: boolean;
  className?: string;
}) {
  const img = (
    <Image
      src={shot.src}
      width={shot.width}
      height={shot.height}
      alt={shot.alt}
      priority={priority}
      className={
        framed
          ? "mx-auto h-auto w-full rounded-[12px] border border-tt-streg"
          : "h-auto w-full"
      }
      style={maxWidth ? { maxWidth } : undefined}
      sizes={maxWidth ? `${maxWidth}px` : "(min-width: 1152px) 1104px, 100vw"}
    />
  );
  return (
    <figure className={className}>
      {framed ? (
        <div className="rounded-[14px] bg-tt-flade p-6 sm:p-10">{img}</div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-tt-streg bg-tt-flade">
          {img}
        </div>
      )}
      <figcaption className="mt-3 text-[13px] text-tt-graa">
        {caption}
      </figcaption>
    </figure>
  );
}
