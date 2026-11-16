import { ImageResponse } from "next/og";
import { brand } from "@/lib/brand";
import { BrandOg, OG_SIZE, ogFonts } from "@/lib/og/brand-og";
import { TIMEWREN_OG_SVG } from "@/lib/og/timewren-og-svg";

export const runtime = "edge";
export const alt =
  brand.id === "timetrack"
    ? "TimeTrack: Hvor mange timer har kunden tilbage? Tidsregistrering med klippekort."
    : "TimeWren: open-source time tracking, prepaid hours and invoicing";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image() {
  if (brand.id !== "timetrack") {
    // Brandkittets og-image (scripts/brand/generate-timewren.mjs); al tekst er paths.
    return new ImageResponse(
      // biome-ignore lint/performance/noImgElement: satori kræver <img>
      <img
        src={`data:image/svg+xml;base64,${btoa(TIMEWREN_OG_SVG)}`}
        width={OG_SIZE.width}
        height={OG_SIZE.height}
        alt=""
      />,
      OG_SIZE,
    );
  }
  return new ImageResponse(
    <BrandOg
      title="Hvor mange timer har kunden tilbage?"
      subtitle="Tidsregistrering med klippekort, til Billy og Dinero"
    />,
    { ...OG_SIZE, fonts: ogFonts() },
  );
}
