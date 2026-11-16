/**
 * Brand-tokens til kode, der ikke kan bruge CSS-variabler (DB-defaults for
 * nye rækker, OG-billeder, ikoner, mails). Samme værdier som
 * docs/brand/tokens.json og --tt-* i globals.css; tokens.test.ts holder dem
 * i sync med JSON-filen.
 */
export const BRAND_LIGHT = {
  papir: "#FFFFFF",
  flade: "#F2F3F0",
  fladeHoej: "#FFFFFF",
  streg: "#DFE2DE",
  kant: "#8A918D",
  blaek: "#1A1D1C",
  graa: "#5F6663",
  gran: "#1E5B47",
  granLys: "#E2EDE8",
  granMoerk: "#164536",
  paaGran: "#FFFFFF",
  fokus: "#1E5B47",
} as const;

/**
 * Varm æggeskal (issue #875, variant A). KUN til marketingsitets flader
 * (--tt-flade-varm i .tt-lys-blokken, Tailwind-utility bg-tt-flade-varm:
 * forside-FAQ og Footer). Dashboard/app bruger stadig BRAND_LIGHT.flade
 * (#F2F3F0), uændret, og der findes ingen mørk variant: marketingsitet er
 * altid lyst.
 */
export const BRAND_MARKETING_FLADE_VARM = "#F5F0E6" as const;

export const BRAND_DARK = {
  papir: "#0A0A0A",
  flade: "#151816",
  fladeHoej: "#1C201E",
  streg: "#2A2F2D",
  kant: "#6B736F",
  blaek: "#ECEFED",
  graa: "#A3ABA7",
  gran: "#5FB38F",
  granLys: "#18291F",
  granMoerk: "#7FC4A6",
  paaGran: "#0A0A0A",
  fokus: "#5FB38F",
} as const;

/**
 * Defaults for NYE rækker i portalBranding og invoiceTemplates. DB-kolonnernes
 * egne defaults (schema.ts) er bevidst urørte, så der ikke skal en migration
 * til; app-koden sætter værdierne eksplicit ved oprettelse. Eksisterende
 * kunders valg ændres aldrig.
 */
export const DEFAULT_PORTAL_COLORS = {
  primaryColor: BRAND_LIGHT.gran,
  secondaryColor: BRAND_LIGHT.granMoerk,
  accentColor: "#10B981",
  backgroundColor: BRAND_LIGHT.papir,
  textColor: BRAND_LIGHT.blaek,
} as const;

export const DEFAULT_INVOICE_PRIMARY_COLOR = BRAND_LIGHT.gran;
