import type { ExportOutput } from "../storage";

/** Samler det, en eksport skriver, til én ZIP (kun til tests). */
export async function collectZip<T>(
  run: (out: ExportOutput) => Promise<T>,
): Promise<{ zip: Uint8Array; result: T }> {
  const chunks: Uint8Array[] = [];
  const result = await run({
    async write(chunk) {
      chunks.push(chunk);
    },
  });
  const zip = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    zip.set(c, offset);
    offset += c.byteLength;
  }
  return { zip, result };
}
