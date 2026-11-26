#!/usr/bin/env node
// Genererer alle TimeWren-billeder i assets/timewren/ fra mærket i assets/timewren/source/mark.svg
// (kopi af public/brand/timewren/mark.svg i webrepoet mahope/timetrack). Udskift SVG'en og kør igen:
//
//   node scripts/generate-timewren-assets.mjs            # PNG'erne, som app.config.ts bruger
//   node scripts/generate-timewren-assets.mjs --previews # plus skærmbilleder i docs/screenshots/timewren/
//
// Farverne læses fra config/brands.ts. SVG'ens egen farve (Wren) er den, der erstattes.
import { Buffer } from 'node:buffer';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets', 'timewren');
const previewDir = join(root, 'docs', 'screenshots', 'timewren');
// config/brands.ts er TypeScript uden "type": "module", så farverne læses som tekst frem for import.
const brands = readFileSync(join(root, 'config', 'brands.ts'), 'utf8');
function colour(key) {
  const value = brands.match(new RegExp(`${key}: '(#[0-9A-Fa-f]{6})'`))?.[1];
  if (!value)
    throw new Error(`config/brands.ts mangler ${key}`);
  return value;
}
const timewren = { backgroundColor: colour('backgroundColor'), darkColor: colour('darkColor') };

const master = readFileSync(join(outDir, 'source', 'mark.svg'), 'utf8');
const MASTER_COLOUR = '#8A5A2B';
if (!master.includes(MASTER_COLOUR))
  throw new Error(`mark.svg indeholder ikke mærkefarven ${MASTER_COLOUR}`);

const WHITE = '#FFFFFF';

/** @param {string} hex */
const rgb = hex => ({ r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16), alpha: 1 });

/** Mærket i `colour`, tegnet så hele SVG'ens viewBox fylder `box` px, centreret på et gennemsigtigt `canvas`-felt. */
async function mark(colour, box, canvas = box) {
  const svg = master.replaceAll(MASTER_COLOUR, colour).replace('width="64" height="64"', `width="${box}" height="${box}"`);
  const png = await sharp(Buffer.from(svg), { density: 144 }).resize(box, box).png().toBuffer();
  if (canvas === box)
    return png;
  const pad = Math.round((canvas - box) / 2);
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: png, left: pad, top: pad }])
    .png()
    .toBuffer();
}

/** Fuldt dækkende flade med mærket i midten (ingen gennemsigtighed: iOS afviser det). */
async function onSolid(background, colour, { box, size }) {
  return sharp({ create: { width: size, height: size, channels: 4, background: rgb(background) } })
    .composite([{ input: await mark(colour, box), gravity: 'centre' }])
    .flatten({ background: rgb(background) })
    .png()
    .toBuffer();
}

/** Hvid silhuet: kantpixels kan få grålig RGB, så RGB tvinges til 255 og kun alfa bevares. */
async function whiteSilhouette(box, canvas) {
  const { data, info } = await sharp(await mark(WHITE, box, canvas)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

mkdirSync(outDir, { recursive: true });
const write = (name, buffer) => sharp(buffer).toFile(join(outDir, name));

// App-ikon: Lichen-flade, Wren-mærke. iOS runder selv hjørnerne.
await write('icon.png', await onSolid(timewren.backgroundColor, MASTER_COLOUR, { box: 700, size: 1024 }));
// Adaptivt Android-ikon: hele mærket (halespidsen ligger ca. 0,61 × boksen fra midten) skal ligge inden for
// den runde sikre zone, 66 dp af 108 dp = radius 313 px af 1024. Boks 500 giver ca. 306 px.
const ADAPTIVE_BOX = 500;
await write('adaptive-icon.png', await mark(MASTER_COLOUR, ADAPTIVE_BOX, 1024));
await write('adaptive-icon-monochrome.png', await whiteSilhouette(ADAPTIVE_BOX, 1024));
await write('notification-icon.png', await whiteSilhouette(84, 96));
// Splash: Wren på Lichen i lys tilstand, Lichen på Thicket i mørk, som i webbrandet.
await write('splash-icon.png', await mark(MASTER_COLOUR, 512));
await write('splash-icon-dark.png', await mark(timewren.backgroundColor, 512));
await write('favicon.png', await mark(MASTER_COLOUR, 64));

if (process.argv.includes('--previews')) {
  mkdirSync(previewDir, { recursive: true });
  const phone = { width: 1170, height: 2532 };
  const splash = async (name, background, image) => {
    const logo = await sharp(image).resize(480, 480).png().toBuffer(); // imageWidth 160 pt × 3
    await sharp({ create: { ...phone, channels: 4, background: rgb(background) } })
      .composite([{ input: logo, gravity: 'centre' }])
      .png()
      .toFile(join(previewDir, name));
  };
  await splash('splash-light.png', timewren.backgroundColor, join(outDir, 'splash-icon.png'));
  await splash('splash-dark.png', timewren.darkColor, join(outDir, 'splash-icon-dark.png'));

  // Ikon på en hjemmeskærmsflade: iOS-afrunding (≈22,4 %) og Android-cirkel (adaptivt ikon på Lichen).
  const rounded = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="115" fill="#fff"/></svg>');
  const circle = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="256" fill="#fff"/></svg>');
  const ios = await sharp(join(outDir, 'icon.png')).resize(512, 512).composite([{ input: rounded, blend: 'dest-in' }]).png().toBuffer();
  const androidBase = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: rgb(timewren.backgroundColor) } })
    .composite([{ input: join(outDir, 'adaptive-icon.png') }])
    .png()
    .toBuffer();
  // Launchere viser kun 72 dp af de 108 dp, så der beskæres til midten (683 px) før cirkelmasken.
  const viewport = Math.round((1024 * 72) / 108);
  const viewportOffset = Math.floor((1024 - viewport) / 2);
  const android = await sharp(androidBase).extract({ left: viewportOffset, top: viewportOffset, width: viewport, height: viewport }).resize(512, 512).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
  for (const [name, surface] of [['icon-light.png', '#F4F4F2'], ['icon-dark.png', '#16191A']]) {
    await sharp({ create: { width: 1200, height: 700, channels: 4, background: rgb(surface) } })
      .composite([{ input: ios, left: 60, top: 94 }, { input: android, left: 628, top: 94 }])
      .png()
      .toFile(join(previewDir, name));
  }
}
