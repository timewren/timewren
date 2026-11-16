import { useId } from "react";
import { brand as buildBrand } from "@/lib/brand";

/** Det Logo behøver af et brand; kan sendes serialiseret fra serveren. */
export type LogoBrand = {
  id: string;
  name: string;
  logo: { icon: string };
};

/**
 * TimeTracks logo (docs/BRAND.md → Logo): en billet, hvor klippet er et ur.
 *
 * - `mark="ikon"` (standard): hvid billet i grøn firkant, til alle størrelser
 *   til og med 32 px (navigation, app, favicon-agtige flader).
 * - `mark="maerke"`: grøn billet uden firkant, til store flader fra 48 px.
 *
 * Farverne kommer fra --tt-* tokens, så logoet følger lys/mørk automatisk
 * (også media-fallbacken uden .dark-klasse): i mørk bliver ikonet til
 * `tt-ikon-moerk` (lys grøn flade, mørk billet). Ordmærket er levende tekst
 * i Schibsted Grotesk 700 med -0,02em tracking.
 *
 * Kilder: docs/brand/logo/tt-ikon.svg, tt-ikon-moerk.svg, tt-maerke.svg.
 */

type LogoSize = "sm" | "md" | "lg" | "xl";

interface LogoProps {
  size?: LogoSize;
  showText?: boolean;
  mark?: "ikon" | "maerke";
  /** "lys" til flader, der altid er hvide (marketing), uanset tema. */
  tone?: "auto" | "lys";
  className?: string;
  /** Multibrand: brandet for denne host. Udeladt = build-brandet. */
  brand?: LogoBrand;
}

const markPx: Record<LogoSize, number> = { sm: 24, md: 28, lg: 32, xl: 48 };

const textClasses: Record<LogoSize, string> = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-xl",
  xl: "text-3xl",
};

/** React-id'er indeholder tegn (":", "«»"), som kan knække url(#…). */
function safeId(raw: string, prefix: string): string {
  return `${prefix}-${raw.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

export function TtIkon({
  size = 32,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const maskId = safeId(useId(), "tt-ikon-m");
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="32"
          height="32"
        >
          <rect x="3" y="8" width="26" height="16" rx="2.5" fill="#fff" />
          <g fill="#000">
            <circle cx="3" cy="16" r="3" />
            <circle cx="29" cy="16" r="3" />
            <circle cx="17" cy="16" r="5.6" />
          </g>
        </mask>
      </defs>
      <rect width="32" height="32" rx="7" style={{ fill: "var(--tt-gran)" }} />
      <g style={{ fill: "var(--tt-paa-gran)" }}>
        <rect width="32" height="32" mask={`url(#${maskId})`} />
        <rect x="16.2" y="12" width="1.6" height="4.8" rx=".8" />
        <rect x="16.2" y="15.2" width="4" height="1.8" rx=".8" />
      </g>
    </svg>
  );
}

export function TtMaerke({
  size = 48,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const maskId = safeId(useId(), "tt-maerke-m");
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="32"
          height="32"
        >
          <rect x="1.5" y="6" width="29" height="20" rx="3.5" fill="#fff" />
          <g fill="#000">
            <circle cx="1.5" cy="16" r="3.4" />
            <circle cx="30.5" cy="16" r="3.4" />
            <circle cx="18" cy="16" r="6.4" />
          </g>
        </mask>
      </defs>
      <g style={{ fill: "var(--tt-gran)" }}>
        <rect width="32" height="32" mask={`url(#${maskId})`} />
        <rect x="17.1" y="11.4" width="1.8" height="5.4" rx=".9" />
        <rect x="17.1" y="15.1" width="4.6" height="1.8" rx=".9" />
      </g>
    </svg>
  );
}

/**
 * Brandets ikon. TimeTrack tegner sit eget SVG-ikon med tema-farver; andre
 * brands (TimeWren) bruger deres ikonfil fra brand.logo.icon.
 */
export function BrandIcon({
  size = 32,
  className = "",
  title,
  brand = buildBrand,
}: {
  size?: number;
  className?: string;
  title?: string;
  brand?: LogoBrand;
}) {
  if (brand.id === "timetrack") {
    return <TtIkon size={size} className={className} title={title} />;
  }
  return (
    // biome-ignore lint/performance/noImgElement: statisk SVG fra /public, ingen optimering nødvendig
    <img
      src={brand.logo.icon}
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
    />
  );
}

export function Logo({
  size = "md",
  showText = true,
  mark = "ikon",
  tone = "auto",
  className = "",
  brand = buildBrand,
}: LogoProps) {
  const px =
    mark === "maerke" ? Math.max(markPx[size], 48) : Math.min(markPx[size], 32);
  const label = showText ? undefined : brand.name;
  return (
    <span
      className={`flex items-center gap-2 ${tone === "lys" ? "tt-lys" : ""} ${className}`}
    >
      {mark === "maerke" && brand.id === "timetrack" ? (
        <TtMaerke size={px} title={label} />
      ) : (
        <BrandIcon size={px} title={label} brand={brand} />
      )}
      {showText && (
        <span
          className={`${textClasses[size]} font-bold tracking-[-0.02em] text-tt-blaek`}
        >
          {brand.name}
        </span>
      )}
    </span>
  );
}
