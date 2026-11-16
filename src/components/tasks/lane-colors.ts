/**
 * Farver til tavlens kolonner. `id` er nøglen til farvenavnet i
 * tasks.laneColors (til skærmlæsere); `name` er det danske navn.
 */
export const LANE_COLORS = [
  { value: "#9ca3af", id: "gray", name: "Grå" },
  { value: "#64748b", id: "slate", name: "Skifer" },
  { value: "#a16207", id: "brown", name: "Brun" },
  { value: "#f97316", id: "orange", name: "Orange" },
  { value: "#f59e0b", id: "amber", name: "Rav" },
  { value: "#10b981", id: "green", name: "Grøn" },
  { value: "#3b82f6", id: "blue", name: "Blå" },
  { value: "#8b5cf6", id: "purple", name: "Lilla" },
  { value: "#ec4899", id: "pink", name: "Pink" },
  { value: "#ef4444", id: "red", name: "Rød" },
] as const;

export function laneColorName(value: string): string {
  return (
    LANE_COLORS.find((c) => c.value.toLowerCase() === value.toLowerCase())
      ?.name ?? value
  );
}

/** Nøglen til farvenavnet i tasks.laneColors, eller null for en ukendt farve. */
export function laneColorId(value: string): string | null {
  return (
    LANE_COLORS.find((c) => c.value.toLowerCase() === value.toLowerCase())
      ?.id ?? null
  );
}
