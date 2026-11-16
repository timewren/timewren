import type { Href } from 'expo-router';

/**
 * Typed routes er slået til, men flere ruter bygges af andre features
 * (/invoices, /tasks, /enterprise/…). Denne helper lader os linke til dem
 * uden at typerne brækker før ruterne findes.
 */
export function href(path: string): Href {
  return path as Href;
}

export const WEB_APP_URL = 'https://app.timetrack.dk';
export const PRIVACY_URL = 'https://timetrack.dk/privacy';
export const TERMS_URL = 'https://timetrack.dk/terms';
/** Apples standard-licensaftale (EULA): vilkårene for abonnementer købt i App Store. */
export const APPLE_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
export const WEBSITE_URL = 'https://timetrack.dk';

/** Butikssiderne (production-bundle `dk.timetrack.app`, App Store-id fra eas.json). */
export const APP_STORE_URL = 'https://apps.apple.com/app/id6812371822';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=dk.timetrack.app';

export function storeUrl(os: string): string {
  return os === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
}
