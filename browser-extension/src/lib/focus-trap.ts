/**
 * Fokusfælde for dialoger: hvor skal Tab hen, når fokus står på
 * `currentIndex` af `count` fokuserbare elementer? null = lad browseren
 * flytte fokus selv, -1 = fokusér dialogen (intet at tabbe til).
 * `currentIndex` -1 betyder, at fokus står uden for dialogen.
 */
export function trapTabTarget(
  count: number,
  currentIndex: number,
  shift: boolean,
): number | null {
  if (count === 0) return -1;
  if (currentIndex === -1) return shift ? count - 1 : 0;
  if (shift && currentIndex === 0) return count - 1;
  if (!shift && currentIndex === count - 1) return 0;
  return null;
}

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Hvilken af de åbne dialoger (nederst først) skal reagere på Esc? Den
 * øverste modale, eller en inline (ikke-modal) boks over den, hvis fokus
 * står i boksen. -1 = ingen.
 */
export function activeDialogIndex(
  dialogs: { modal: boolean; hasFocus: boolean }[],
): number {
  for (let i = dialogs.length - 1; i >= 0; i--) {
    if (dialogs[i].modal || dialogs[i].hasFocus) return i;
  }
  return -1;
}
