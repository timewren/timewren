import { randomBytes } from "node:crypto";

/**
 * Indlejrede data:-billeder i en videresendt mail.
 *
 * Outlook indlejrer indsatte skærmbilleder som `data:image/...;base64,...`,
 * og de kan være enorme og give Resend-fejl, hvis de bliver i html'en. Før
 * blev de lagt i S3 som offentlige objekter. Nu flyttes de i stedet ud som
 * inline CID-vedhæftninger i selve mailen (`<img src="cid:...">`), så intet
 * indhold bliver liggende hos os og ingen får en offentlig URL.
 */

export interface InlineImageAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
  /** Referenceres i html'en som `cid:<contentId>`. */
  contentId: string;
}

/** Kun rasterbilleder. SVG kan indeholde scripts og vises ikke af mailklienter. */
const RASTER_EXTENSIONS: Record<string, string> = {
  png: "png",
  jpeg: "jpg",
  jpg: "jpg",
  gif: "gif",
  webp: "webp",
  bmp: "bmp",
};

/** Samlet loft for indlejrede billeder i én mail (Resend tillader 40 MB i alt). */
export const MAX_INLINE_IMAGE_BYTES = 15 * 1024 * 1024;

const PLACEHOLDER =
  '<p style="color:#6b7280;font-style:italic">[Indlejret billede fjernet]</p>';

const DATA_IMAGE_RE =
  /(<img\b[^>]*\bsrc=["'])data:image\/([^;]+);base64,([^"']+)(["'][^>]*>)/gi;

/**
 * Erstatter data:-billeder med `cid:`-referencer og returnerer billederne som
 * vedhæftninger. Billeder der ikke kan videresendes (ikke-raster, tomme eller
 * over loftet) erstattes af en tekst-placeholder.
 */
export function extractInlineImages(html: string): {
  html: string;
  attachments: InlineImageAttachment[];
} {
  const attachments: InlineImageAttachment[] = [];
  let totalBytes = 0;

  const rewritten = html.replace(
    DATA_IMAGE_RE,
    (
      _full: string,
      prefix: string,
      mime: string,
      base64: string,
      suffix: string,
    ) => {
      const ext = RASTER_EXTENSIONS[mime.toLowerCase()];
      if (!ext) return PLACEHOLDER;

      // Estimér den afkodede størrelse før Buffer.from, så store billeder over
      // budgettet aldrig allokeres.
      const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
      const estimated = Math.floor((base64.length * 3) / 4) - padding;
      if (totalBytes + estimated > MAX_INLINE_IMAGE_BYTES) return PLACEHOLDER;

      const content = Buffer.from(base64, "base64");
      if (content.length === 0) return PLACEHOLDER;
      if (totalBytes + content.length > MAX_INLINE_IMAGE_BYTES) {
        return PLACEHOLDER;
      }
      totalBytes += content.length;

      const contentId = `inline-${attachments.length + 1}-${randomBytes(6).toString("hex")}`;
      attachments.push({
        filename: `billede-${attachments.length + 1}.${ext}`,
        content,
        contentType: `image/${mime.toLowerCase() === "jpg" ? "jpeg" : mime.toLowerCase()}`,
        contentId,
      });
      return `${prefix}cid:${contentId}${suffix}`;
    },
  );

  return { html: rewritten, attachments };
}
