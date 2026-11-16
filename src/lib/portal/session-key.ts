/**
 * localStorage-nøgler til kundeportalens sessioner.
 *
 * Den generiske nøgle er delt for hele browseren. Token-links skal derfor
 * gemme sessionen under en nøgle scopet til selve token'et, så et link til
 * kunde B aldrig genbruger kunde A's session. Den generiske nøgle skrives
 * stadig, fordi de øvrige portalsider (time-report, approvals, dashboard)
 * kun kender den.
 */
export const PORTAL_SESSION_KEY = "portalSession";

/**
 * Kort, synkron digest af token'et.
 *
 * Nøglenavnet skal kun skille to tokens fra hinanden — det behøver ikke være
 * kryptografisk, men det rå, langlivede access-token må ikke stå i klartekst
 * blandt browserens localStorage-nøgler. To FNV-1a-varianter sættes sammen
 * til 64 bit, hvilket er rigeligt til de få tokens én browser ser.
 *
 * Synkron med vilje: nøglen skal bruges direkte i en useEffect, hvor et
 * async `crypto.subtle.digest` ville give en ekstra render uden nøgle.
 */
function digestToken(token: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc2b2ae35;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h1) + hex(h2);
}

/**
 * Nøglen for en token-scopet portalsession, eller `null` hvis token'et er
 * blankt. `null` betyder "ingen session at genbruge" — et blankt token må
 * ALDRIG falde tilbage til den generiske nøgle, for så ville `/portal/t/%20`
 * genbruge en fremmed kundes session.
 */
export function portalSessionKey(token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  return `${PORTAL_SESSION_KEY}:${digestToken(trimmed)}`;
}

/** Sand for den generiske nøgle og alle token-scopede nøgler. */
export function isPortalSessionKey(key: string): boolean {
  return key === PORTAL_SESSION_KEY || key.startsWith(`${PORTAL_SESSION_KEY}:`);
}

/** Rydder alle portalsession-nøgler — brugt ved logout. */
export function clearPortalSessions(): void {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isPortalSessionKey(key)) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}
