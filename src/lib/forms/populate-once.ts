/**
 * Skal en redigeringsformular udfyldes fra serverdata nu?
 *
 * Kun når en (ny) post er indlæst — ikke ved hver refetch af samme post.
 * Ellers overskriver en refetch (fokus, anden fane, SSE) det brugeren er
 * ved at skrive; datofelter bryder structural sharing, så selv uændrede
 * data giver et nyt objekt.
 */
export function shouldPopulateForm(
  populatedId: string | null,
  entryId: string | null | undefined,
): boolean {
  return !!entryId && entryId !== populatedId;
}
