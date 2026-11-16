/**
 * Grænser for billed-uploads (#1117).
 *
 * `request.formData()` buffer hele bodyen, før ruten kan tjekke filens
 * størrelse, og sharp dekoder som standard op til ~268 megapixel. Begge dele
 * lader en enkelt request binde hukommelse langt ud over filgrænsen.
 */

/** Plads til multipart-grænser og de øvrige felter ud over selve filen. */
const MULTIPART_OVERHEAD = 64 * 1024;

/**
 * Højeste antal pixels sharp må dekode. 64 MP dækker 8000×8000 og
 * kamerabilleder op til 48 MP; en "dekomprimeringsbombe" afvises på headeren.
 */
export const MAX_INPUT_PIXELS = 64_000_000;

/** sharp-options for upload-billeder. */
export const SHARP_INPUT_OPTIONS = { limitInputPixels: MAX_INPUT_PIXELS };

/**
 * Læs multipart-bodyen, men stop så snart den overstiger `maxFileBytes` plus
 * multipart-overhead. Afviser straks på Content-Length, og tæller ellers
 * bytes mens strømmen læses (chunked upload uden Content-Length).
 *
 * @returns FormData, eller null hvis bodyen er for stor.
 */
export async function readFormDataWithLimit(
  request: Request,
  maxFileBytes: number,
): Promise<FormData | null> {
  const maxBytes = maxFileBytes + MULTIPART_OVERHEAD;

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }

  return new Response(Buffer.concat(chunks), {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  }).formData();
}
