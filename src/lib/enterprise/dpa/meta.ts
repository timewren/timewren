import { createHash } from "node:crypto";
import { DPA_MARKDOWN, DPA_VERSION, DPA_VERSION_DATE } from "./content";

/**
 * Fakta om den gældende aftaletekst, som PDF'en og siden viser. Kun server
 * (node:crypto).
 */

/** sha256 af hele aftaleteksten (docs/DPA.md), hex. */
export const DPA_SHA256 = createHash("sha256")
  .update(DPA_MARKDOWN, "utf8")
  .digest("hex");

/** Kort udgave til footer og ETag: de første 16 hex-tegn. */
export const DPA_SHA256_SHORT = DPA_SHA256.slice(0, 16);

export { DPA_VERSION, DPA_VERSION_DATE };

/** Databehandlerens elektroniske underskrift. Aldrig et billede. */
export const DPA_PROCESSOR_SIGNATURE =
  "Underskrevet elektronisk af Mads Holst Jensen for Mahope (Mahoje), CVR 39413892";

/** Brødteksten uden titel og versionslinje (vises separat i hero/forside). */
export function dpaBodyMarkdown(markdown: string = DPA_MARKDOWN): string {
  return markdown
    .replace(/^# .*\n+/, "")
    .replace(/^\*\*Version [^\n]*\*\*\n+/, "");
}

/** Filnavn til download, fx TimeTrack-databehandleraftale-v1.1.pdf */
export function dpaPdfFilename(filled: boolean): string {
  return `TimeTrack-databehandleraftale-v${DPA_VERSION}${filled ? "-udfyldt" : ""}.pdf`;
}
