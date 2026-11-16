import { brand } from "@/lib/brand";
import { BRAND_DARK, BRAND_LIGHT } from "@/lib/brand/tokens";
import { getAppUrl } from "@/lib/config";

/**
 * Farver, font og mål til alle mails (EmailShell og PersonalEmailLayout).
 * Brandfarverne kommer fra tokens (docs/BRAND.md), så skabelonerne aldrig
 * skriver hex selv. Mailene er lyse med faste farver: de klienter, der selv
 * inverterer (Gmail iOS, Outlook på Windows), får mellemtoner, der stadig
 * kan læses, og de klienter, der læser prefers-color-scheme, får MAIL_DARK
 * via email-dark-mode.tsx.
 */
export const MAIL = {
  page: BRAND_LIGHT.flade,
  card: BRAND_LIGHT.papir,
  surface: BRAND_LIGHT.flade,
  line: BRAND_LIGHT.streg,
  edge: BRAND_LIGHT.kant,
  text: BRAND_LIGHT.blaek,
  muted: BRAND_LIGHT.graa,
  brand: BRAND_LIGHT.gran,
  brandLight: BRAND_LIGHT.granLys,
  brandDark: BRAND_LIGHT.granMoerk,
  onBrand: BRAND_LIGHT.paaGran,
} as const;

export const MAIL_DARK = {
  page: BRAND_DARK.papir,
  card: BRAND_DARK.flade,
  surface: BRAND_DARK.fladeHoej,
  line: BRAND_DARK.streg,
  edge: BRAND_DARK.kant,
  text: BRAND_DARK.blaek,
  muted: BRAND_DARK.graa,
  brand: BRAND_DARK.gran,
  brandLight: BRAND_DARK.granLys,
  onBrand: BRAND_DARK.paaGran,
} as const;

/**
 * Statusfarver (advarsel, fejl, succes) bruges kun, hvor mailen faktisk
 * advarer om noget, aldrig som pynt (BRAND.md → Farver). Samme toner som
 * appens statusfarver; teksten har mindst 4,5:1 mod sin baggrund.
 */
export const MAIL_STATUS = {
  warning: { bg: "#FFF7E6", border: "#B45309", text: "#7A3E06" },
  danger: { bg: "#FDF0EF", border: "#B42318", text: "#8A1C13" },
  success: {
    bg: BRAND_LIGHT.granLys,
    border: BRAND_LIGHT.gran,
    text: BRAND_LIGHT.granMoerk,
  },
  info: {
    bg: BRAND_LIGHT.flade,
    border: BRAND_LIGHT.gran,
    text: BRAND_LIGHT.blaek,
  },
} as const;

/** BRAND.md → Mail: de fleste ser Arial, og det er i orden. */
export const MAIL_FONT = '"Schibsted Grotesk", Arial, sans-serif';
export const MAIL_FONT_MONO = 'Consolas, "Courier New", monospace';

export const MAIL_WIDTH = 600;
/** BRAND.md → Layout: mails har 10 px hjørneradius, knapper 8 px. */
export const MAIL_RADIUS = "10px";
export const MAIL_BUTTON_RADIUS = "8px";

const APP_URL = getAppUrl();
/**
 * Billederne ligger under public/brand/ og skal være hostet på timetrack.dk,
 * ikke på app-domænet, så de virker i alle miljøer.
 */
export const MAIL_LOGO_URL = brand.logo.mailIcon;
/**
 * Mads' portræt i de personlige mails. Kun TimeTrack Cloud har et (hostet på
 * cloudUrl); en selvhostet instans får intet billede, så en mailklient aldrig
 * henter noget fra Mahope (#1024).
 */
export const MAIL_AVATAR_URL = brand.cloudUrl
  ? `${brand.cloudUrl}/brand/mads-128.jpg`
  : undefined;
export const MAIL_APP_URL = APP_URL;
/** Standardlinks i mails, når kalderen ikke giver et. TimeTrack bruger sin offentlige adresse som hidtil. */
export const MAIL_DASHBOARD_URL =
  brand.id === "timetrack"
    ? "https://timetrack.dk/dashboard"
    : `${APP_URL}/dashboard`;
export const MAIL_LOGIN_URL =
  brand.id === "timetrack" ? "https://timetrack.dk/login" : `${APP_URL}/login`;

/**
 * `bgcolor`-attributten på en tabelcelle (Outlook læser den, ikke CSS).
 * React kender den ikke på `<td>`, men skriver den ud uændret.
 */
export function bgAttr(color: string): object {
  return { bgcolor: color };
}
