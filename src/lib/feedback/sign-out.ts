/**
 * Bindeleddet mellem log ud (`signOut` i `auth-client.ts`) og
 * feedback-panelets offline-kø.
 *
 * Log ud må ikke trække bugbottle med, så den kender kun dette lille modul.
 * Panelet registrerer, hvad der skal ske ved log ud (send det, der venter, og
 * tøm køen), og `signOut` venter højst `timeoutMs` på det.
 */

type BeforeSignOut = () => Promise<void>;

let beforeSignOut: BeforeSignOut | null = null;

/** Registrerer panelets oprydning. Returnerer afregistreringen. */
export function onFeedbackSignOut(fn: BeforeSignOut): () => void {
  beforeSignOut = fn;
  return () => {
    if (beforeSignOut === fn) beforeSignOut = null;
  };
}

/** Kaldes lige før `signOut()`. Kaster aldrig og venter højst `timeoutMs`. */
export async function prepareFeedbackForSignOut(
  timeoutMs = 1500,
): Promise<void> {
  const fn = beforeSignOut;
  if (!fn) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    fn().catch(() => {}),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
}
