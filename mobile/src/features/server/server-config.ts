import type { Brand } from '../../../config/brands';
import Env from 'env';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { timetrack } from '../../../config/brands';
import { normalizeServerUrl, webHostFromUrl } from './server-logic';

export const timewrenBrand = Constants.expoConfig?.extra?.timewren as (Brand & { scheme: string }) | undefined;
export const isTimeWren = !!timewrenBrand;
export const SERVER_KEY = 'timewren-server';

/** Navn, links og butiks-id for det brand, appen er bygget som. */
export const brand: Brand = timewrenBrand ?? timetrack;

// Immutable during this JS lifetime: all clients change together after restart.
const apiUrl = timewrenBrand
  ? normalizeServerUrl(SecureStore.getItem(SERVER_KEY) ?? timewrenBrand.cloudUrl)
  : Env.EXPO_PUBLIC_API_URL;

export function getApiUrl(): string {
  return apiUrl;
}

/**
 * Webadressen i tekster som "Administreres på …": host (med port) for den server, brugeren er
 * logget ind på. Uden en brugbar API-URL bruges brandets cloud (app.timetrack.dk/app.timewren.com).
 */
export function getWebHost(): string {
  return webHostFromUrl(apiUrl, webHostFromUrl(brand.cloudUrl, ''));
}

export function authStoragePrefix(): string {
  return isTimeWren
    ? `timewren-${Array.from(apiUrl).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`
    : 'timetrack';
}
