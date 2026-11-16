/**
 * Piletaster i en faneliste (ARIA tabs): venstre/højre går rundt, Home og
 * End til første og sidste. null = tasten flytter ikke fanen.
 */
export function tabKeyTarget(
  count: number,
  current: number,
  key: string,
): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
