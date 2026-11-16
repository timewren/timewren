#!/usr/bin/env node
/**
 * Butiksgrafik til Chrome Web Store, Edge og Firefox (genereres, uploades
 * ikke): promo-tiles 440×280, 920×680 og 1400×560 samt skærmbilleder i
 * 1280×800. Bygget af HTML-skabeloner her i filen og rendret i headless
 * Chromium med Schibsted Grotesk fra extensionens bundle.
 *
 * Kræver, at popup-billederne findes (kør først):
 *   npm run build
 *   node scripts/store-screenshots.mjs ../docs/brand/screenshots/extension/efter
 * Brug:
 *   node scripts/store-assets.mjs
 *
 * Udseendet følger docs/BRAND.md: hvid/kølig grå flade, granskov som eneste
 * farve, venstrestillet tekst, ingen gradienter, én skygge (på produktet).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = resolve(here, "..");
const shots = resolve(
  extRoot,
  "..",
  "docs",
  "brand",
  "screenshots",
  "extension",
  "efter",
);
const outPromo = join(extRoot, "store-assets", "promo");
const outShots = join(extRoot, "store-assets", "screenshots");
const require = createRequire(join(extRoot, "..", "package.json"));
const { chromium } = require("playwright");

const dataUri = (file, type) =>
  `data:${type};base64,${readFileSync(file).toString("base64")}`;
const fontFile = readdirSync(join(extRoot, "dist", "assets")).find((f) =>
  /latin-wght-normal\.woff2$/.test(f),
);
const fontExtFile = readdirSync(join(extRoot, "dist", "assets")).find((f) =>
  /latin-ext-wght-normal\.woff2$/.test(f),
);
if (!fontFile) throw new Error("Byg extensionen først (npm run build)");
const font = dataUri(join(extRoot, "dist", "assets", fontFile), "font/woff2");
const fontExt = dataUri(
  join(extRoot, "dist", "assets", fontExtFile),
  "font/woff2",
);
const ikon = dataUri(
  join(extRoot, "public", "icons", "tt-ikon.svg"),
  "image/svg+xml",
);
const shot = (name) => {
  const f = join(shots, `${name}.png`);
  if (!existsSync(f))
    throw new Error(`Mangler ${f}. Kør store-screenshots.mjs først.`);
  return dataUri(f, "image/png");
};

mkdirSync(outPromo, { recursive: true });
mkdirSync(outShots, { recursive: true });

// Hullerne tegnes som i appen: 20 t-kort med 13 brugt = 7 t tilbage.
const huller = (total, used, px, gap) =>
  `<div class="huller" style="grid-template-columns:repeat(${total},${px}px);gap:${gap}px">${Array.from(
    { length: total },
    (_, i) =>
      `<span class="hul${i < used ? " brugt" : ""}" style="width:${px}px;height:${px}px"></span>`,
  ).join("")}</div>`;

const css = `
@font-face{font-family:"SG";src:url(${font}) format("woff2");font-weight:400 900;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"SG";src:url(${fontExt}) format("woff2");font-weight:400 900;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+A720-A7FF}
:root{--papir:#fff;--flade:#F2F3F0;--streg:#DFE2DE;--kant:#8A918D;--blaek:#1A1D1C;--graa:#5F6663;--gran:#1E5B47}
*{box-sizing:border-box;margin:0}
html,body{width:100%;height:100%}
body{font-family:"SG",Arial,sans-serif;color:var(--blaek);background:var(--papir);overflow:hidden;-webkit-font-smoothing:antialiased}
.wrap{position:relative;width:100%;height:100%;display:flex;align-items:center}
.maerke{display:flex;align-items:center;gap:.45em;font-weight:700;letter-spacing:-.02em}
.maerke img{display:block}
h1{font-weight:700;letter-spacing:-.035em;line-height:1.04}
p.sub{color:var(--graa);line-height:1.35}
.huller{display:grid}
.hul{display:block;border-radius:50%;border:1.5px solid var(--kant)}
.hul.brugt{background:var(--gran);border-color:var(--gran)}
.saldo{color:var(--graa)}
.saldo b{color:var(--blaek);font-weight:600}
.popup{display:block;border-radius:14px;border:1px solid var(--streg);box-shadow:0 18px 50px rgba(26,29,28,.16)}
.flade{background:var(--flade)}
`;

const page = (w, h, body, bg = "papir") =>
  `<!doctype html><html lang="da"><head><meta charset="utf-8"><style>${css}</style></head><body class="${bg === "flade" ? "flade" : ""}" style="width:${w}px;height:${h}px">${body}</body></html>`;

const tiles = {
  // Lille tile: mærke, én linje og klippekortet
  "promo-440x280": page(
    440,
    280,
    `<div class="wrap" style="padding:0 36px">
      <div>
        <div class="maerke" style="font-size:26px"><img src="${ikon}" width="40" height="40" alt="">TimeTrack</div>
        <h1 style="font-size:25px;margin-top:22px">Tidsregistrering med klippekort</h1>
        <div style="margin-top:18px">${huller(20, 13, 12, 5)}</div>
        <div class="saldo" style="font-size:14px;margin-top:9px"><b>7 t</b> tilbage af 20</div>
      </div>
    </div>`,
  ),
  // Stor tile: spørgsmålet til venstre, popup'en til højre
  "promo-920x680": page(
    920,
    680,
    `<div class="wrap" style="padding:0 0 0 64px;gap:48px">
      <div style="flex:1">
        <div class="maerke" style="font-size:28px"><img src="${ikon}" width="44" height="44" alt="">TimeTrack</div>
        <h1 style="font-size:50px;margin-top:40px">Hvor mange timer har kunden tilbage?</h1>
        <p class="sub" style="font-size:20px;margin-top:20px;max-width:360px">Start timeren i browseren. TimeTrack trækker tiden fra kundens klippekort.</p>
      </div>
      <img class="popup" src="${shot("popup-lys")}" style="width:360px;margin-right:56px" alt="">
    </div>`,
    "flade",
  ),
  // Marquee: samme opbygning i bredformat, popup'en beskåret i bunden
  "promo-1400x560": page(
    1400,
    560,
    `<div class="wrap" style="padding:0 0 0 96px;align-items:center">
      <div style="flex:1;max-width:640px">
        <div class="maerke" style="font-size:30px"><img src="${ikon}" width="46" height="46" alt="">TimeTrack</div>
        <h1 style="font-size:58px;margin-top:36px">Hvor mange timer har kunden tilbage?</h1>
        <p class="sub" style="font-size:22px;margin-top:20px;max-width:520px">Tidsregistrering fra browseren, med klippekort, Billy og Dinero. Lavet i Danmark.</p>
      </div>
      <div style="position:absolute;right:120px;top:56px">
        <img class="popup" src="${shot("popup-lys")}" style="width:380px" alt="">
      </div>
    </div>`,
    "flade",
  ),
};

// Butiksskærmbilleder 1280×800: én pointe pr. billede, rigtig popup.
const storeShot = (headline, sub, img, { dark = false, wide = false } = {}) =>
  page(
    1280,
    800,
    `<div class="wrap" style="padding:0 0 0 88px;gap:64px;${dark ? "background:#0A0A0A;color:#ECEFED" : ""}">
      <div style="flex:1;max-width:${wide ? 380 : 470}px">
        <div class="maerke" style="font-size:24px"><img src="${dark ? dataUri(join(extRoot, "public", "icons", "tt-ikon-moerk.svg"), "image/svg+xml") : ikon}" width="38" height="38" alt="">TimeTrack</div>
        <h1 style="font-size:46px;margin-top:36px">${headline}</h1>
        <p class="sub" style="font-size:20px;margin-top:18px;${dark ? "color:#A3ABA7" : ""}">${sub}</p>
      </div>
      <img class="popup" src="${img}" style="${wide ? "width:700px;margin-right:0;border-radius:14px 0 0 14px" : "width:400px;margin-right:110px"};${dark ? "border-color:#2A2F2D;box-shadow:none" : ""}" alt="">
    </div>`,
    dark ? "papir" : "flade",
  );

const screenshots = {
  "1-timer-og-klippekort": storeShot(
    "Start timeren, og se saldoen",
    "Timeren kører på kunden, og hullerne viser, hvor mange timer der er tilbage på klippekortet.",
    shot("popup-lys"),
  ),
  "2-klippekort": storeShot(
    "Alle klippekort ét sted",
    "7 t tilbage af 20. Saldoen står som det, der er tilbage, med en advarsel, når den bliver lav.",
    shot("popup-klippekort-lys"),
  ),
  "3-hurtig-registrering": storeShot(
    "Skriv timer ind bagefter",
    "Glemte du timeren? Vælg kunde, skriv 1,5 t og gem. Uden at åbne appen.",
    shot("popup-hurtig-lys"),
  ),
  "4-ny-fane": storeShot(
    "Dagen i en ny fane",
    "Timeren, dagens timer og de seneste registreringer, hver gang du åbner en fane. Kan slås fra.",
    shot("nyfane-butik-lys"),
    { wide: true },
  ),
  "5-moerk": storeShot(
    "Også i mørk tilstand",
    "Følger systemets tema, eller vælg selv lys eller mørk i indstillingerne.",
    shot("popup-moerk"),
    { dark: true },
  ),
};

const browser = await chromium.launch();
try {
  const render = async (html, w, h, file) => {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
    });
    const p = await ctx.newPage();
    await p.setContent(html, { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    const ok = await p.evaluate(() => document.fonts.check('700 20px "SG"'));
    if (!ok) throw new Error(`Fonten blev ikke indlæst i ${file}`);
    await p.screenshot({ path: file });
    await ctx.close();
    console.log(file);
  };
  for (const [name, html] of Object.entries(tiles)) {
    const [, w, h] = name.match(/(\d+)x(\d+)/);
    await render(html, Number(w), Number(h), join(outPromo, `${name}.png`));
  }
  for (const [name, html] of Object.entries(screenshots)) {
    await render(html, 1280, 800, join(outShots, `${name}.png`));
  }
} finally {
  await browser.close();
}
