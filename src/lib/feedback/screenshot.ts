/** Server-side validering af screenshot-data-url fra feedback-boblen. */

export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024; // 2 MB binært

const DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodeScreenshotDataUrl(dataUrl: string): Buffer {
  if (!dataUrl.startsWith(DATA_URL_PREFIX)) {
    throw new Error("Screenshot skal være en PNG data-url");
  }
  const buf = Buffer.from(dataUrl.slice(DATA_URL_PREFIX.length), "base64");
  if (buf.length > MAX_SCREENSHOT_BYTES) {
    throw new Error("Screenshot er for stort (max 2 MB)");
  }
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error("Screenshot er ikke en gyldig PNG");
  }
  return buf;
}
