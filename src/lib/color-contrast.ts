/**
 * WCAG-farvekontrast på rå hex-farver. Bruges til at beregne tekstfarve ud
 * fra en kundefarve, der ellers kan give lav kontrast på en badge (#864).
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToRgb(hex: string): Rgb {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized;
  const value = Number.parseInt(full, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, "0")).join("")}`;
}

function channelLuminance(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** WCAG relativ luminans for en hex-farve, 0 (sort) til 1 (hvid). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** WCAG-kontrastforhold mellem to hex-farver, fra 1:1 til 21:1. */
export function getContrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Blander `fg` ind over en ensfarvet `bg` med `alpha` (0-1) til en opak hex. */
export function mixHex(fg: string, bg: string, alpha: number): string {
  const f = hexToRgb(fg);
  const b = hexToRgb(bg);
  return rgbToHex({
    r: f.r * alpha + b.r * (1 - alpha),
    g: f.g * alpha + b.g * (1 - alpha),
    b: f.b * alpha + b.b * (1 - alpha),
  });
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3) * 255,
    g: hue2rgb(p, q, h) * 255,
    b: hue2rgb(p, q, h - 1 / 3) * 255,
  };
}

/**
 * Justerer lysstyrken af `fg`, så den har mindst `minRatio` kontrast mod
 * `bg` (WCAG AA = 4,5:1), uden at ændre farvetonen. Bruges til badge-tekst,
 * hvor kundens egen farve skal bruges, men læsbart (#864).
 */
export function accessibleTextColor(
  fg: string,
  bg: string,
  minRatio = 4.5,
): string {
  if (getContrastRatio(fg, bg) >= minRatio) return fg;

  const hsl = rgbToHsl(hexToRgb(fg));
  const bgIsLight = relativeLuminance(bg) > 0.5;
  const step = bgIsLight ? -0.02 : 0.02;

  let l = hsl.l;
  for (let i = 0; i < 50; i++) {
    l = Math.min(1, Math.max(0, l + step));
    const candidate = rgbToHex(hslToRgb({ ...hsl, l }));
    if (getContrastRatio(candidate, bg) >= minRatio) return candidate;
    if (l <= 0 || l >= 1) break;
  }
  return bgIsLight ? "#000000" : "#ffffff";
}
