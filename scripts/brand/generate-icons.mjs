#!/usr/bin/env node
/**
 * Genererer alle platformsikoner fra TimeTracks logo (docs/BRAND.md →
 * Logo og Ikoner pr. platform). Én kilde, mange output.
 *
 *   node scripts/brand/generate-icons.mjs
 *
 * Geometrien er den samme som i docs/brand/logo/tt-ikon.svg (billet med ur
 * som klip i grøn firkant) og tt-maerke.svg (billet uden firkant). Scriptet
 * tegner varianterne ud fra den geometri, fordi flere platforme kræver en
 * anden indramning end kilde-SVG'en:
 *
 * - ≤ 32 px: kun uret (docs/brand/logo/tt-ikon-lille.svg), intet billet-omrids.
 *   Billetten med sprocket-huller bliver en udefinerbar klat ved 16-32 px, og
 *   En kunde så den som et æble (issue #865). Uret fylder det meste af feltet.
 * - iOS: fuld flade uden egen afrunding (iOS lægger masken på) + dark/tinted.
 * - Android adaptive / maskable PWA: billetten inden for safe zone.
 * - Monokrome ikoner (tray-template sort, notifikation hvid).
 *
 * Output:
 *   public/                     web (favicon, apple-touch, PWA, push-badge)
 *   browser-extension/public/icons/   extension 16/32/48/128
 *   docs/brand/generated/       web, extension, desktop og mobil som filer,
 *                               som desktop- og mobil-repoerne kopierer fra
 *                               (se docs/brand/generated/MANIFEST.json)
 *
 * Kun sharp (findes allerede i repoet). .ico og .icns skrives af scriptet
 * selv med indlejrede PNG'er.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tokens = JSON.parse(
  readFileSync(join(ROOT, "docs/brand/tokens.json"), "utf8"),
);
const GRAN = tokens.color.light.gran; // #1E5B47
const PAPIR = tokens.color.light.papir; // #FFFFFF
const DARK_FLADE = tokens.color.iconOnDark.flade; // #5FB38F
const DARK_BILLET = tokens.color.iconOnDark.billet; // #0E100F

// ---------------------------------------------------------------------------
// Geometri (viewBox 0 0 32 32)
// ---------------------------------------------------------------------------

/** tt-ikon: billet 26×16 med uret som klip. `thick` = 16 px-udgaven. */
function ikonParts({ thick = false } = {}) {
  const hands = thick
    ? `<rect x="15.8" y="11.2" width="2.4" height="6" rx="1.2"/><rect x="15.8" y="14.8" width="4.8" height="2.4" rx="1.2"/>`
    : `<rect x="16.2" y="12" width="1.6" height="4.8" rx=".8"/><rect x="16.2" y="15.2" width="4" height="1.8" rx=".8"/>`;
  return {
    body: `<rect x="3" y="8" width="26" height="16" rx="2.5" fill="#fff"/>`,
    holes: `<circle cx="3" cy="16" r="3"/><circle cx="29" cy="16" r="3"/><circle cx="17" cy="16" r="${thick ? 5.8 : 5.6}"/>`,
    hands,
    // halv diagonal af billetten, til safe zone-beregning
    halfDiagonal: Math.hypot(13, 8),
  };
}

/** tt-maerke: billet 29×20, bruges uden firkant (monokrome ikoner). */
function maerkeParts({ thick = false } = {}) {
  const hands = thick
    ? `<rect x="16.8" y="10.8" width="2.6" height="6.4" rx="1.3"/><rect x="16.8" y="14.6" width="5.4" height="2.6" rx="1.3"/>`
    : `<rect x="17.1" y="11.4" width="1.8" height="5.4" rx=".9"/><rect x="17.1" y="15.1" width="4.6" height="1.8" rx=".9"/>`;
  return {
    body: `<rect x="1.5" y="6" width="29" height="20" rx="3.5" fill="#fff"/>`,
    holes: `<circle cx="1.5" cy="16" r="3.4"/><circle cx="30.5" cy="16" r="3.4"/><circle cx="18" cy="16" r="6.4"/>`,
    hands,
    halfDiagonal: Math.hypot(14.5, 10),
  };
}

/**
 * Bygger en SVG.
 * @param bg   null (gennemsigtig) eller { color, rx } (rx i 32-enheder; 0 = fuld flade)
 * @param fg   farven på billetten
 * @param scale skalering af billetten om centrum
 * @param frame skalering af hele ikonet (flade + billet) om centrum, fx macOS-gitter
 */
function svg({ parts, bg = null, fg, scale = 1, frame = 1, id = "m" }) {
  const t = (s) => `translate(16 16) scale(${s}) translate(-16 -16)`;
  const bgEl = bg
    ? `<rect width="32" height="32" rx="${bg.rx}" fill="${bg.color}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><g transform="${t(scale)}">${parts.body}<g fill="#000">${parts.holes}</g></g></mask></defs>
<g transform="${t(frame)}">${bgEl}<rect width="32" height="32" fill="${fg}" mask="url(#${id})"/><g transform="${t(scale)}" fill="${fg}">${parts.hands}</g></g>
</svg>`;
}

/** Skala, så billettens diagonal ligger inden for en cirkel med `fraction` af bredden. */
const fitCircle = (parts, fraction) => (16 * fraction) / parts.halfDiagonal;

/**
 * Lille ur-ikon (issue #865, ≤ 32 px): kun uret, intet billet-omrids. Samme
 * geometri som docs/brand/logo/tt-ikon-lille.svg; ret begge steder.
 */
function urSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="7" fill="${GRAN}"/><circle cx="16" cy="16" r="11" fill="${PAPIR}"/><rect x="14.4" y="6.6" width="3.2" height="10.4" rx="1.6" fill="${GRAN}"/><rect x="16" y="14.4" width="9.4" height="3.2" rx="1.6" fill="${GRAN}"/><circle cx="16" cy="16" r="2" fill="${GRAN}"/></svg>`;
}

const IKON = ikonParts();
const MAERKE = maerkeParts();
const MAERKE_THICK = maerkeParts({ thick: true });

const V = {
  // Standard: hvid billet i grøn afrundet firkant (= tt-ikon.svg)
  ikon: svg({ parts: IKON, bg: { color: GRAN, rx: 7 }, fg: PAPIR }),
  // ≤ 32 px: kun uret (= tt-ikon-lille.svg)
  urLille: urSvg(),
  // Mørk baggrund (= tt-ikon-moerk.svg)
  ikonMoerk: svg({
    parts: IKON,
    bg: { color: DARK_FLADE, rx: 7 },
    fg: DARK_BILLET,
  }),
  // Fuld flade uden afrunding (iOS, apple-touch): platformen lægger masken på
  fuldFlade: svg({ parts: IKON, bg: { color: GRAN, rx: 0 }, fg: PAPIR }),
  // Maskable PWA: billetten inden for den runde safe zone (80 %)
  maskable: svg({
    parts: IKON,
    bg: { color: GRAN, rx: 0 },
    fg: PAPIR,
    scale: fitCircle(IKON, 0.78),
  }),
  // Android adaptive forgrund: hvid billet på gennemsigtig, inden for 61 %
  adaptivForgrund: svg({
    parts: IKON,
    fg: PAPIR,
    scale: fitCircle(IKON, 0.6),
  }),
  // iOS 18 dark: gennemsigtig baggrund, billet i lys granskov
  iosDark: svg({ parts: IKON, fg: DARK_FLADE }),
  // iOS 18 tinted: gråtone (hvid billet på sort), systemet farver selv
  iosTinted: svg({
    parts: IKON,
    bg: { color: "#000000", rx: 0 },
    fg: "#FFFFFF",
  }),
  // macOS: afrundet firkant i Apples ikon-gitter (824/1024 med luft)
  macos: svg({
    parts: IKON,
    bg: { color: GRAN, rx: 7.2 },
    fg: PAPIR,
    frame: 824 / 1024,
  }),
  // Monokrome
  trayTemplate: svg({ parts: MAERKE_THICK, fg: "#000000" }),
  notifikation: svg({ parts: MAERKE, fg: "#FFFFFF", scale: 0.9 }),
  notifikationLille: svg({ parts: MAERKE_THICK, fg: "#FFFFFF", scale: 0.9 }),
  // Splash: hele ikonet (virker på lys og mørk splash-baggrund)
  splash: svg({ parts: IKON, bg: { color: GRAN, rx: 7 }, fg: PAPIR }),
  splashMoerk: svg({
    parts: IKON,
    bg: { color: DARK_FLADE, rx: 7 },
    fg: DARK_BILLET,
  }),
  // Extension "timer kører": ikonet med lys prik øverst til højre
  extensionKoerer: null,
};
V.extensionKoerer = V.ikon.replace(
  "</svg>",
  `<circle cx="26" cy="6" r="5.5" fill="${DARK_FLADE}" stroke="${PAPIR}" stroke-width="1.5"/></svg>`,
);
V.urLilleKoerer = V.urLille.replace(
  "</svg>",
  `<circle cx="25.5" cy="6.5" r="6" fill="${DARK_FLADE}" stroke="${PAPIR}" stroke-width="2"/></svg>`,
);

// ---------------------------------------------------------------------------
// Rendering og containere
// ---------------------------------------------------------------------------

async function png(svgString, size, { flatten } = {}) {
  let img = sharp(Buffer.from(svgString), {
    density: Math.max(72, (72 * size) / 32) * 2,
  }).resize(size, size);
  if (flatten) img = img.flatten({ background: flatten });
  return img.png({ compressionLevel: 9 }).toBuffer();
}

/** .ico med indlejrede PNG'er (understøttet siden Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

/** .icns med PNG-typer (macOS 10.7+). */
function icns(images) {
  const chunks = images.map(({ type, data }) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, "ascii");
    h.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([h, data]);
  });
  const body = Buffer.concat(chunks);
  const h = Buffer.alloc(8);
  h.write("icns", 0, "ascii");
  h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

const written = [];
function write(rel, data) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  written.push(rel.replaceAll("\\", "/"));
}

const ikonFor = (size) => (size <= 32 ? V.urLille : V.ikon);

// ---------------------------------------------------------------------------
// Web
// ---------------------------------------------------------------------------
const G = "docs/brand/generated";

async function web() {
  write("public/icon.svg", `${V.ikon}\n`);
  write("public/icons/favicon-16x16.png", await png(ikonFor(16), 16));
  write("public/icons/favicon-32x32.png", await png(ikonFor(32), 32));
  write(
    "public/favicon.ico",
    ico([
      { size: 16, data: await png(ikonFor(16), 16) },
      { size: 32, data: await png(ikonFor(32), 32) },
      { size: 48, data: await png(ikonFor(48), 48) },
    ]),
  );
  const touch = await png(V.fuldFlade, 180, { flatten: GRAN });
  write("public/apple-touch-icon.png", touch);
  write("public/icons/icon-180x180.png", touch);
  for (const s of [72, 96, 128, 144, 152, 192, 384, 512]) {
    write(`public/icons/icon-${s}x${s}.png`, await png(V.ikon, s));
  }
  for (const s of [192, 512]) {
    write(
      `public/icons/icon-maskable-${s}x${s}.png`,
      await png(V.maskable, s, { flatten: GRAN }),
    );
  }
  // Android viser push-badgen som monokrom silhuet
  write("public/icons/badge-72x72.png", await png(V.notifikation, 72));
  // Kopier til docs til andre flader (mails m.m.)
  write(`${G}/web/tt-ikon-48.png`, await png(V.ikon, 48));
  write(`${G}/web/tt-ikon-96.png`, await png(V.ikon, 96));
  write(`${G}/web/tt-ikon-moerk-96.png`, await png(V.ikonMoerk, 96));
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------
async function extension() {
  write("browser-extension/public/icons/icon.svg", `${V.ikon}\n`);
  for (const s of [16, 32, 48, 128]) {
    const data = await png(ikonFor(s), s);
    write(`browser-extension/public/icons/icon-${s}.png`, data);
    write(`${G}/extension/icon-${s}.png`, data);
  }
  for (const s of [16, 32, 48, 128]) {
    write(
      `${G}/extension/icon-running-${s}.png`,
      await png(s <= 32 ? V.urLilleKoerer : V.extensionKoerer, s),
    );
  }
}

// ---------------------------------------------------------------------------
// Desktop (Tauri: src-tauri/icons/)
// ---------------------------------------------------------------------------
async function desktop() {
  const D = `${G}/desktop`;
  const mac = (s) => png(V.macos, s);
  for (const [name, s] of [
    ["32x32.png", 32],
    ["64x64.png", 64],
    ["128x128.png", 128],
    ["128x128@2x.png", 256],
    ["icon.png", 512],
  ]) {
    write(`${D}/${name}`, await mac(s));
  }
  // Windows Store / MSIX
  for (const s of [30, 44, 71, 89, 107, 142, 150, 284, 310]) {
    write(`${D}/Square${s}x${s}Logo.png`, await png(ikonFor(s), s));
  }
  write(`${D}/StoreLogo.png`, await png(V.ikon, 50));
  write(
    `${D}/icon.ico`,
    ico(
      await Promise.all(
        [16, 24, 32, 48, 64, 256].map(async (s) => ({
          size: s,
          data: await png(ikonFor(s), s),
        })),
      ),
    ),
  );
  write(
    `${D}/icon.icns`,
    icns([
      { type: "icp4", data: await mac(16) },
      { type: "icp5", data: await mac(32) },
      { type: "ic11", data: await mac(32) },
      { type: "ic12", data: await mac(64) },
      { type: "ic07", data: await mac(128) },
      { type: "ic13", data: await mac(256) },
      { type: "ic08", data: await mac(256) },
      { type: "ic14", data: await mac(512) },
      { type: "ic09", data: await mac(512) },
      { type: "ic10", data: await mac(1024) },
    ]),
  );
  // macOS menulinje: monokrom template (sort + alfa), 22 pt @2x = 44 px
  write(`${D}/tray-template.png`, await png(V.trayTemplate, 44));
  write(`${D}/tray-template@1x.png`, await png(V.trayTemplate, 22));
}

// ---------------------------------------------------------------------------
// Mobil (Expo: assets/)
// ---------------------------------------------------------------------------
async function mobile() {
  const M = `${G}/mobile`;
  write(`${M}/icon.png`, await png(V.fuldFlade, 1024, { flatten: GRAN }));
  write(`${M}/icon-dark.png`, await png(V.iosDark, 1024));
  write(
    `${M}/icon-tinted.png`,
    await png(V.iosTinted, 1024, { flatten: "#000000" }),
  );
  write(`${M}/adaptive-icon.png`, await png(V.adaptivForgrund, 1024));
  write(
    `${M}/adaptive-icon-monochrome.png`,
    await png(V.adaptivForgrund, 1024),
  );
  write(`${M}/splash-icon.png`, await png(V.splash, 600));
  write(`${M}/splash-icon-dark.png`, await png(V.splashMoerk, 600));
  write(`${M}/notification-icon.png`, await png(V.notifikationLille, 96));
  write(`${M}/favicon.png`, await png(V.ikon, 64));
  // Til senere brug i timetrack-app (eget repo, issue #865): samme kilde-SVG
  // som docs/brand/logo/tt-ikon-lille.svg, til appens egne små ikonstørrelser.
  write(`${M}/icon-lille.svg`, `${V.urLille}\n`);
}

await web();
await extension();
await desktop();
await mobile();

const manifest = {
  $comment:
    "Genereret af scripts/brand/generate-icons.mjs. Ret ikke filerne i hånden; kør scriptet. 'target' er stien i det repo, filen skal kopieres til.",
  colors: {
    adaptiveIconBackground: GRAN,
    splashBackgroundLight: PAPIR,
    splashBackgroundDark: tokens.color.dark.papir,
    notificationColor: GRAN,
  },
  desktop: {
    repo: "mahope/timetrack-desktop",
    targetDir: "src-tauri/icons/",
    files: written
      .filter((f) => f.startsWith(`${G}/desktop/`))
      .map((f) => f.slice(`${G}/desktop/`.length)),
    note: "tray-template.png er en macOS template (sort + alfa); tray.rs bruger icon_as_template(true). icons/ios og icons/android (Tauri mobil) er ikke genereret.",
  },
  mobile: {
    repo: "mahope/timetrack-app",
    targetDir: "assets/",
    files: written
      .filter((f) => f.startsWith(`${G}/mobile/`))
      .map((f) => f.slice(`${G}/mobile/`.length)),
    note: "icon.png er fuld flade uden afrunding (iOS lægger masken på). adaptive-icon.png er forgrund (billet inden for 61 %); baggrund = adaptiveIconBackground. icon-dark/icon-tinted til iOS 18 (ios.icon.dark/tinted i app.config).",
  },
  extension: {
    repo: "mahope/timetrack (browser-extension/)",
    targetDir: "browser-extension/public/icons/",
    files: written
      .filter((f) => f.startsWith(`${G}/extension/`))
      .map((f) => f.slice(`${G}/extension/`.length)),
    note: "icon-running-* er 'timer kører'-tilstanden til badgeManager (fase 6).",
  },
};
write(`${G}/MANIFEST.json`, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Skrev ${written.length} filer:`);
for (const f of written)
  console.log(`  ${relative(ROOT, join(ROOT, f)).replaceAll("\\", "/")}`);
