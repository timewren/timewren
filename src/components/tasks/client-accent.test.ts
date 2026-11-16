import { describe, expect, it } from "vitest";
import { getContrastRatio } from "@/lib/color-contrast";
import { getClientAccent } from "./client-accent";

// Spænder fra en mørk til en lys kundefarve, som i #864's acceptkriterie.
const CLIENT_COLORS = [
  "#1e3a8a", // mørkeblå
  "#dc2626", // rød
  "#16a34a", // grøn
  "#f59e0b", // amber (lys)
  "#fde047", // lysegul (meget lys)
  "#6b7280", // grå
];

describe("getClientAccent", () => {
  it.each(CLIENT_COLORS)(
    "badge-teksten opfylder 4,5:1 i begge temaer for %s",
    (color) => {
      const accent = getClientAccent(color);
      expect(
        getContrastRatio(accent.badgeTextLight, accent.badgeBgLight),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        getContrastRatio(accent.badgeTextDark, accent.badgeBgDark),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("kanten bruger kundefarven uændret", () => {
    const accent = getClientAccent("#1e5b47");
    expect(accent.border).toBe("#1e5b47");
  });
});
