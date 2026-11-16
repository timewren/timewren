import { accessibleTextColor, mixHex } from "@/lib/color-contrast";

/**
 * Kortets/rækkens egen baggrund i hvert tema (Tailwind bg-white /
 * dark:bg-gray-800), som kundefarvens optoning blandes ind over. Så er
 * blandingen altid en opak farve, der ikke forsvinder i mørk tilstand (#864).
 */
const CARD_SURFACE = { light: "#ffffff", dark: "#1f2937" } as const;

export interface ClientAccent {
  /** Fuld-styrke kundefarve til venstrekanten. */
  border: string;
  tintLight: string;
  tintDark: string;
  badgeBgLight: string;
  badgeTextLight: string;
  badgeBgDark: string;
  badgeTextDark: string;
}

/** Udleder kant-, baggrunds- og badge-farver for en kundefarve i begge temaer. */
export function getClientAccent(clientColor: string): ClientAccent {
  const badgeBgLight = mixHex(clientColor, CARD_SURFACE.light, 0.18);
  const badgeBgDark = mixHex(clientColor, CARD_SURFACE.dark, 0.32);

  return {
    border: clientColor,
    tintLight: mixHex(clientColor, CARD_SURFACE.light, 0.12),
    tintDark: mixHex(clientColor, CARD_SURFACE.dark, 0.26),
    badgeBgLight,
    badgeTextLight: accessibleTextColor(clientColor, badgeBgLight),
    badgeBgDark,
    badgeTextDark: accessibleTextColor(clientColor, badgeBgDark),
  };
}
