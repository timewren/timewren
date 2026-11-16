import { ImageResponse } from "next/og";
import { BrandOg, OG_SIZE, ogFonts } from "@/lib/og/brand-og";

export const runtime = "edge";

/**
 * Dynamiske OG-billeder til delbare marketing-sider:
 * /api/og?title=...&subtitle=...&badge=...&score=NN
 * score rendrer en stor score i stedet for klippekortet (bruges af Freelance
 * Health Checks delte resultat-links, så delingen viser personens score).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clean = (v: string | null, max: number) =>
    (v ?? "")
      .replace(/[\r\n]/g, " ")
      // Tankestreger fra ældre links vises som komma (docs/BRAND.md).
      .replace(/\s+[—–]\s+/g, ", ")
      .slice(0, max);

  const title = clean(searchParams.get("title"), 70) || "TimeTrack";
  const subtitle = clean(searchParams.get("subtitle"), 120);
  const badge = clean(searchParams.get("badge"), 40);
  const scoreRaw = Number(searchParams.get("score"));
  const score =
    searchParams.has("score") &&
    Number.isInteger(scoreRaw) &&
    scoreRaw >= 0 &&
    scoreRaw <= 100
      ? scoreRaw
      : null;

  return new ImageResponse(
    <BrandOg
      title={title}
      subtitle={subtitle || undefined}
      badge={badge || undefined}
      score={score}
    />,
    { ...OG_SIZE, fonts: ogFonts() },
  );
}
