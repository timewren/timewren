/**
 * Genererer raster-brandfiler til mails og PDF fra kilderne i docs/brand/.
 *
 *   node scripts/brand/generate-mail-assets.mjs
 *
 * - public/brand/tt-ikon-64.png: mail-logo i 2× (vises 32 px). Mailklienter
 *   viser ikke SVG med mask, derfor PNG.
 * - public/brand/mads-128.jpg: avatar i 2× (vises 64 px), gråtone, kvadratisk.
 * - src/lib/pdf/brand-icon.ts: ikonet som base64-PNG til PDF-sidefoden, så
 *   PDF-render ikke henter noget over nettet.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

mkdirSync("public/brand", { recursive: true });
const ikon = readFileSync("docs/brand/logo/tt-ikon.svg");

await sharp(ikon, { density: 576 })
  .resize(64, 64)
  .png({ compressionLevel: 9 })
  .toFile("public/brand/tt-ikon-64.png");

// Ansigtet sidder øverst i midten af portrættet (640×960).
await sharp("docs/brand/mads.jpg")
  .extract({ left: 70, top: 120, width: 500, height: 500 })
  .resize(128, 128)
  .grayscale()
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile("public/brand/mads-128.jpg");

const pdfIcon = await sharp(ikon, { density: 576 })
  .resize(48, 48)
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync(
  "src/lib/pdf/brand-icon.ts",
  `/**
 * TimeTrack-ikonet (docs/brand/logo/tt-ikon.svg) som 48 px PNG til
 * PDF-sidefoden. Genereres af scripts/brand/generate-mail-assets.mjs;
 * redigér ikke i hånden.
 */
export const TT_IKON_PNG_BASE64 =
  "${pdfIcon.toString("base64")}";

export const TT_IKON_PNG_DATA_URI = \`data:image/png;base64,\${TT_IKON_PNG_BASE64}\`;
`,
  "utf8",
);
console.log("ok");
