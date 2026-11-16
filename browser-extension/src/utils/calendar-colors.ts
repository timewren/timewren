/**
 * Kalenderblokkenes farve pr. kunde. Før var det hsl(hash, 65%, 50%) bag
 * hvid tekst, som gav ned til 1,5:1. Nu er der en fast palet på 8 toner
 * (--tt-kal-1..8 i theme.css, med mørke varianter), og farven bruges kun
 * som venstrekant og svag tone i fladen; teksten står i tekst-tokens.
 * Intern tid (ingen kunde) er granskov.
 */
export const CALENDAR_PALETTE_SIZE = 8;

export function clientColorIndex(clientId: string): number {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = clientId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % CALENDAR_PALETTE_SIZE;
}

export function clientColorVar(clientId: string | null): string {
  if (!clientId) return "var(--tt-gran)";
  return `var(--tt-kal-${clientColorIndex(clientId) + 1})`;
}
