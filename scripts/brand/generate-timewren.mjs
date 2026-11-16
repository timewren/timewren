#!/usr/bin/env node
/**
 * Genererer TimeWren-brandkittet i public/brand/timewren/ (se README.md dér).
 *
 *   node scripts/brand/generate-timewren.mjs
 *
 * Mærket (gærdesmutten, hvis krop er en urskive og hale er viseren) tegnes her
 * i et 64-gitter. Tekst (ordmærke, OG-linje) konverteres til paths fra
 * Bricolage Grotesque i fonts/, så ingen SVG afhænger af fonten. fontkit er en
 * indirekte afhængighed (via @react-pdf/renderer) og står ikke i package.json;
 * den må ikke fjernes fra lockfilen uden at scriptet tilpasses. sharp tegner
 * PNG'erne.
 *
 * Skriver også src/lib/og/timewren-og-svg.ts, som /opengraph-image bruger,
 * når brandet er timewren.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fontkitNs from "fontkit";
import sharp from "sharp";

const fontkit = fontkitNs.default ?? fontkitNs;
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "public", "brand", "timewren");
const fontPath = join(out, "fonts", "BricolageGrotesque[opsz,wdth,wght].ttf");
mkdirSync(out, { recursive: true });

// Kittets fem farver. Ingen andre.
const C = {
  ink: "#1C2119",
  wren: "#8A5A2B",
  thicket: "#3F5A3A",
  lichen: "#E8EDE3",
  dawn: "#E8B04B",
};

const r2 = (n) => Math.round(n * 100) / 100;

// --- Mærket ---------------------------------------------------------------
// Kroppen er en cirkel (urskiven) med centrum (30,36). Viseren står kl. 1
// (30°): udstanset i kroppen fra centrum og videre ud som halen.
const CX = 30;
const CY = 36;
const R = 20;
const pt = (deg, r) => [
  r2(CX + r * Math.sin((deg * Math.PI) / 180)),
  r2(CY - r * Math.cos((deg * Math.PI) / 180)),
];
const HAND_IN = pt(30, R - 1);
const HAND_OUT = pt(30, 33);
const BEAK = [pt(-86, R - 3), [1.5, 28.5], pt(-58, R - 3)];
/** Mærkets bounding box i 64-gitteret (krop, næb og hale). */
const MARK_BOX = {
  x: 1.5,
  y: r2(CY - 33 * Math.cos(Math.PI / 6) - 4),
  w: 49,
  h: 0,
};
MARK_BOX.h = r2(CY + R - MARK_BOX.y);
/** Kvadratisk viewBox med mærket centreret og lidt luft. */
const MARK_VIEWBOX = (() => {
  const s = 56;
  const x = MARK_BOX.x + MARK_BOX.w / 2 - s / 2;
  const y = MARK_BOX.y + MARK_BOX.h / 2 - s / 2;
  return `${r2(x)} ${r2(y)} ${s} ${s}`;
})();

/**
 * Mærket som SVG-elementer i 64-gitteret. `id` skal være unikt pr. dokument
 * (masken). `body` farver krop og næb, `tail` halen (Dawn kun i aktiv tilstand).
 */
function markShapes({ body, tail = body, id = "tw" }) {
  return (
    `<defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">` +
    `<rect width="64" height="64" fill="#fff"/>` +
    `<line x1="${CX}" y1="${CY}" x2="${HAND_IN[0]}" y2="${HAND_IN[1]}" stroke="#000" stroke-width="6" stroke-linecap="round"/>` +
    `<circle cx="18.5" cy="29" r="3.4" fill="#000"/></mask></defs>` +
    `<g mask="url(#${id})" fill="${body}"><circle cx="${CX}" cy="${CY}" r="${R}"/>` +
    `<path d="M${BEAK.map((p) => p.join(" ")).join(" L")}Z"/></g>` +
    `<line x1="${HAND_IN[0]}" y1="${HAND_IN[1]}" x2="${HAND_OUT[0]}" y2="${HAND_OUT[1]}" stroke="${tail}" stroke-width="8" stroke-linecap="round"/>`
  );
}

const svgDoc = (viewBox, w, h, inner, extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}"${extra}>${inner}</svg>\n`;

const markSvg = (opts, title = "TimeWren") =>
  svgDoc(
    MARK_VIEWBOX,
    64,
    64,
    `<title>${title}</title>${markShapes(opts)}`,
    ' role="img"',
  );

// --- Tekst til paths ------------------------------------------------------
const font = fontkit.openSync(fontPath);
const UPM = font.unitsPerEm;
const CAP = font.capHeight;

/** Tekst som én path. Returnerer path-data i px med baseline i y=0. */
function textPath(text, { size, wght, opsz = 96, tracking = 0 }) {
  const v = font.getVariation({ wght, opsz, wdth: 100 });
  const run = v.layout(text);
  const s = size / UPM;
  let x = 0;
  const parts = [];
  run.glyphs.forEach((g, i) => {
    const pos = run.positions[i];
    const d = g.path
      .scale(s, -s)
      .translate(x + pos.xOffset * s, -pos.yOffset * s)
      .toSVG();
    if (d) parts.push(d);
    x += pos.xAdvance * s + tracking * size;
  });
  const width = x - tracking * size;
  return { d: roundPath(parts.join("")), width };
}

function roundPath(d) {
  return d.replace(/-?\d*\.\d+(e-?\d+)?/g, (n) => String(r2(Number(n))));
}

// --- Ordmærket ------------------------------------------------------------
// "timewren" i Bricolage Grotesque 680, -0,02 em, mærket til venstre i
// versalhøjde (urskiven står på grundlinjen, halen rager op over).
const WM_SIZE = 100;
const wmText = textPath("timewren", {
  size: WM_SIZE,
  wght: 680,
  opsz: 96,
  tracking: -0.02,
});
const capPx = (CAP / UPM) * WM_SIZE;
// Urskiven (diameter 2R) = versalhøjde + lidt overshoot.
const markScale = (capPx * 1.04) / (2 * R);
const markH = MARK_BOX.h * markScale;
const markW = MARK_BOX.w * markScale;
const gap = WM_SIZE * 0.2;
const wmBaseline = markH; // halens top i y=0
const WM = {
  width: r2(markW + gap + wmText.width),
  height: r2(markH + (270 / UPM) * WM_SIZE * 0.25),
};

/** Ordmærket som gruppe; (0,0) er øverst til venstre. */
function wordmarkGroup({ mark, tail = mark, text, id = "twm" }) {
  const overshoot = capPx * 0.02;
  const tx = -MARK_BOX.x * markScale;
  const ty = wmBaseline + overshoot - (CY + R) * markScale;
  return (
    `<g transform="translate(${r2(tx)} ${r2(ty)}) scale(${r2(markScale * 1000) / 1000})">${markShapes({ body: mark, tail, id })}</g>` +
    `<path transform="translate(${r2(markW + gap)} ${r2(wmBaseline)})" fill="${text}" d="${wmText.d}"/>`
  );
}

const wordmarkSvg = (opts) =>
  svgDoc(
    `0 0 ${WM.width} ${WM.height}`,
    WM.width,
    WM.height,
    `<title>TimeWren</title>${wordmarkGroup(opts)}`,
    ' role="img"',
  );

// --- Filer ----------------------------------------------------------------
const files = {};
files["mark.svg"] = markSvg({ body: C.wren });
files["mark-mono.svg"] = markSvg({ body: C.ink });
files["mark-light.svg"] = markSvg({ body: C.lichen });
// Favicon: Wren på lyse faner, Lichen på mørke.
files["favicon.svg"] = svgDoc(
  MARK_VIEWBOX,
  64,
  64,
  `<style>.b{fill:#8A5A2B}.t{stroke:#8A5A2B}@media (prefers-color-scheme:dark){.b{fill:#E8EDE3}.t{stroke:#E8EDE3}}</style>` +
    markShapes({ body: "currentColor", id: "tw" })
      .replace('fill="currentColor"', 'class="b"')
      .replace('stroke="currentColor"', 'class="t"'),
);
files["wordmark.svg"] = wordmarkSvg({ mark: C.wren, text: C.ink });
files["wordmark-light.svg"] = wordmarkSvg({ mark: C.lichen, text: C.lichen });

/** Mærket centreret i et kvadrat på flade; `fill` = mærkets andel af siden. */
function iconSvg(size, { bg, fill, radius = 0, body = C.wren }) {
  const k = (size * fill) / Math.max(MARK_BOX.w, MARK_BOX.h);
  const x = size / 2 - (MARK_BOX.x + MARK_BOX.w / 2) * k;
  const y = size / 2 - (MARK_BOX.y + MARK_BOX.h / 2) * k;
  return svgDoc(
    `0 0 ${size} ${size}`,
    size,
    size,
    `<rect width="${size}" height="${size}" rx="${r2(size * radius)}" fill="${bg}"/>` +
      `<g transform="translate(${r2(x)} ${r2(y)}) scale(${r2(k * 1000) / 1000})">${markShapes({ body })}</g>`,
  );
}

// Tagline til OG, GitHub og bannere.
const TAGLINE = "Open-source time tracking, prepaid hours and invoicing";

/** Ordmærke + tagline venstrestillet på flade. */
function heroSvg(
  w,
  h,
  { bg, mark, tail, text, sub, wmWidth, tagSize, padX, id },
) {
  const k = wmWidth / WM.width;
  const tag = textPath(TAGLINE, {
    size: tagSize,
    wght: 480,
    opsz: 24,
    tracking: -0.005,
  });
  const blockH = WM.height * k + tagSize * 1.9;
  const top = (h - blockH) / 2;
  return svgDoc(
    `0 0 ${w} ${h}`,
    w,
    h,
    `<rect width="${w}" height="${h}" fill="${bg}"/>` +
      `<g transform="translate(${padX} ${r2(top)}) scale(${r2(k * 10000) / 10000})">${wordmarkGroup({ mark, tail, text, id })}</g>` +
      `<path transform="translate(${r2(padX + 0.06 * k * WM_SIZE)} ${r2(top + WM.height * k + tagSize * 1.6)})" fill="${sub}" d="${tag.d}"/>`,
  );
}

files["og-image.svg"] = heroSvg(1200, 630, {
  bg: C.lichen,
  mark: C.wren,
  text: C.ink,
  sub: C.ink,
  wmWidth: 640,
  tagSize: 40,
  padX: 96,
  id: "og",
});
files["github-social-preview.svg"] = heroSvg(1280, 640, {
  bg: C.lichen,
  mark: C.wren,
  text: C.ink,
  sub: C.ink,
  wmWidth: 680,
  tagSize: 42,
  padX: 104,
  id: "gh",
});
files["readme-banner-light.svg"] = heroSvg(1280, 320, {
  bg: C.lichen,
  mark: C.wren,
  text: C.ink,
  sub: C.ink,
  wmWidth: 520,
  tagSize: 34,
  padX: 88,
  id: "bl",
});
// Mørk variant: Thicket-flade, Lichen-mærke og Dawn på viseren (eneste accent).
files["readme-banner-dark.svg"] = heroSvg(1280, 320, {
  bg: C.thicket,
  mark: C.lichen,
  tail: C.dawn,
  text: C.lichen,
  sub: C.lichen,
  wmWidth: 520,
  tagSize: 34,
  padX: 88,
  id: "bd",
});

for (const [name, svg] of Object.entries(files)) {
  // OG og GitHub-preview er kun mellemtrin til PNG.
  if (name === "og-image.svg" || name === "github-social-preview.svg") continue;
  writeFileSync(join(out, name), svg);
}

// SVG'ens egen bredde er 64 (mærket) eller lig målet (ikoner); tegn 2x og skalér ned.
const png = (svg, size, file, intrinsic = size) =>
  sharp(Buffer.from(svg), { density: ((72 * size) / intrinsic) * 2 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(out, file));

const ICON = { bg: C.lichen, fill: 0.72, radius: 0.22 };
await png(iconSvg(192, ICON), 192, "icon-192.png");
await png(iconSvg(512, ICON), 512, "icon-512.png");
// Maskable: fuld flade; mærket holdes inde i den sikre zone (cirkel på 80 %).
await png(
  iconSvg(192, { bg: C.lichen, fill: 0.56 }),
  192,
  "icon-maskable-192.png",
);
await png(
  iconSvg(512, { bg: C.lichen, fill: 0.56 }),
  512,
  "icon-maskable-512.png",
);
// apple-touch: fuld flade uden afrunding (iOS lægger masken på).
await png(
  iconSvg(180, { bg: C.lichen, fill: 0.68 }),
  180,
  "apple-touch-icon.png",
);
await png(files["mark.svg"], 64, "mark-64.png", 64);
await png(files["mark.svg"], 32, "favicon-32.png", 64);
await png(files["mark.svg"], 16, "favicon-16.png", 64);

// favicon.ico med PNG-billeder i 16, 32 og 48.
const icoImages = await Promise.all(
  [16, 32, 48].map((s) =>
    sharp(Buffer.from(files["mark.svg"]), { density: 72 * 4 })
      .resize(s, s)
      .png({ compressionLevel: 9 })
      .toBuffer()
      .then((buf) => ({ s, buf })),
  ),
);
const header = Buffer.alloc(6 + 16 * icoImages.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoImages.length, 4);
let offset = header.length;
icoImages.forEach(({ s, buf }, i) => {
  const e = 6 + i * 16;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(buf.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += buf.length;
});
writeFileSync(
  join(out, "favicon.ico"),
  Buffer.concat([header, ...icoImages.map((i) => i.buf)]),
);

const flat = (svg, w, h, file) =>
  sharp(Buffer.from(svg), { density: 72 })
    .resize(w, h)
    .png({ compressionLevel: 9 })
    .toFile(join(out, file));
await flat(files["og-image.svg"], 1200, 630, "og-image.png");
await flat(
  files["github-social-preview.svg"],
  1280,
  640,
  "github-social-preview.png",
);

// OG-billedet til /opengraph-image (satori/resvg tegner SVG'en som <img>).
writeFileSync(
  join(root, "src", "lib", "og", "timewren-og-svg.ts"),
  `// Genereret af scripts/brand/generate-timewren.mjs. Ret ikke i hånden.\n` +
    `export const TIMEWREN_OG_SVG =\n  '${files["og-image.svg"].trim()}';\n`,
);

console.log("TimeWren-brandkit genereret i", out);
