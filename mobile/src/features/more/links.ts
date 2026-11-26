import type { Href } from 'expo-router';
import type { Brand } from '../../../config/brands';
import { brand } from '~/features/server/server-config';

/**
 * Typed routes er slået til, men flere ruter bygges af andre features
 * (/invoices, /tasks, /enterprise/…). Denne helper lader os linke til dem
 * uden at typerne brækker før ruterne findes.
 */
export function href(path: string): Href {
  return path as Href;
}

/** Privatliv, vilkår, website og butikssider for et brand (config/brands.ts). */
export function brandLinks(b: Brand) {
  return {
    privacy: b.privacyUrl,
    terms: b.termsUrl,
    website: b.websiteUrl,
    appStore: `https://apps.apple.com/app/id${b.appStoreId}`,
    playStore: `https://play.google.com/store/apps/details?id=${b.applicationId}`,
  };
}

const links = brandLinks(brand);

export const PRIVACY_URL = links.privacy;
export const TERMS_URL = links.terms;
/** Apples standard-licensaftale (EULA): vilkårene for abonnementer købt i App Store. */
export const APPLE_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
export const WEBSITE_URL = links.website;

/** Butikssiderne for production-bundlen (TimeTrack `dk.timetrack.app`, TimeWren `com.timewren.app`). */
export const APP_STORE_URL = links.appStore;
export const PLAY_STORE_URL = links.playStore;

export function storeUrl(os: string): string {
  return os === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
}
