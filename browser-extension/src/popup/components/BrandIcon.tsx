/**
 * TimeTracks ikon (billet med uret som klip, docs/BRAND.md → Logo).
 * Lys udgave som standard; på mørkt tema skiftes til tt-ikon-moerk.svg,
 * fordi det grønne ikon kun giver 2,49:1 mod #0A0A0A. Skiftet styres af
 * .tt-logo-lys/.tt-logo-moerk i styles/theme.css, så det følger både
 * indstillingen "Tema" og systemets mørk tilstand.
 *
 * Ikonet er pynt ved siden af ordmærket "TimeTrack" og har derfor tom alt.
 */
export function BrandIcon({ size }: { size: number }) {
  return (
    <span
      className="inline-block flex-shrink-0"
      style={{ width: size, height: size }}
    >
      <img
        src="icons/tt-ikon.svg"
        alt=""
        width={size}
        height={size}
        className="tt-logo-lys"
      />
      <img
        src="icons/tt-ikon-moerk.svg"
        alt=""
        width={size}
        height={size}
        className="tt-logo-moerk"
      />
    </span>
  );
}
