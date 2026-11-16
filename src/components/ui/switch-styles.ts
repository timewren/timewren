/**
 * Fælles farver til tænd/sluk-kontakter (docs/BRAND.md → Kanter, fokus og
 * trykflader; Dark mode).
 *
 * Sporet skal have mindst 3:1 mod baggrunden i begge tilstande (WCAG 1.4.11):
 * - slukket: `--tt-kant` (#8A918D lys, #6B736F mørk)
 * - tændt: `--tt-gran` (#1E5B47 lys, #5FB38F mørk). brand-600 i mørk gav
 *   kun 2,5:1 mod #0A0A0A.
 * Tommelen er hvid, og på det tændte spor `--tt-paa-gran` (hvid i lys,
 * #0A0A0A i mørk), fordi hvid på #5FB38F kun giver 2,5:1.
 *
 * Tokens skifter både med `.dark`-klassen og med media-fallbacken.
 */

/** Til `<input type="checkbox" className="peer sr-only">` + søster-div. */
export const SWITCH_PEER_TRACK =
  "peer h-6 w-11 rounded-full bg-tt-kant transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:bg-tt-gran peer-checked:after:translate-x-full peer-checked:after:bg-tt-paa-gran peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-tt-fokus peer-disabled:cursor-not-allowed peer-disabled:opacity-50";

/** Spor til en `<button role="switch">`. */
export function switchTrack(on: boolean): string {
  return on ? "bg-tt-gran" : "bg-tt-kant";
}

/** Tommel til en `<button role="switch">`. */
export function switchThumb(on: boolean): string {
  return on ? "bg-tt-paa-gran" : "bg-white";
}
