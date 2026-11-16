import Env from 'env';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { normalizeServerUrl } from './server-logic';

export const timewrenBrand = Constants.expoConfig?.extra?.timewren as {
  name: string;
  scheme: string;
  cloudUrl: string;
} | undefined;
export const isTimeWren = !!timewrenBrand;
export const SERVER_KEY = 'timewren-server';

// Immutable during this JS lifetime: all clients change together after restart.
const apiUrl = timewrenBrand
  ? normalizeServerUrl(SecureStore.getItem(SERVER_KEY) ?? timewrenBrand.cloudUrl)
  : Env.EXPO_PUBLIC_API_URL;

export function getApiUrl(): string {
  return apiUrl;
}

export function authStoragePrefix(): string {
  return isTimeWren
    ? `timewren-${Array.from(apiUrl).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`
    : 'timetrack';
}
