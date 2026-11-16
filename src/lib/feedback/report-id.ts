/**
 * Rapportnummeret, brugeren ser i panelets bekræftelse, er de første 8 tegn
 * af rækkens uuid. Admin-listen viser det samme, og søgefeltet dér finder en
 * rapport på det (eller på et længere stykke af uuid'et).
 */

export const REPORT_ID_LENGTH = 8;

export function shortReportId(id: string): string {
  return id.slice(0, REPORT_ID_LENGTH);
}

/**
 * Det, en admin har skrevet i søgefeltet, som et præfiks af et uuid, eller
 * null hvis det ikke kan være det. Kun hex og bindestreg slipper igennem, så
 * præfikset kan bruges direkte i en LIKE uden wildcards fra brugeren.
 */
export function reportIdPrefix(input: string): string | null {
  const clean = input.trim().replace(/^#/, "").toLowerCase();
  return /^[0-9a-f-]{1,36}$/.test(clean) ? clean : null;
}
