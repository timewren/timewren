import { getBrandId } from "./brand-id";

/**
 * Google Ads-konto (gtag.js) for Mahopes egen markedsføring af TimeTrack Cloud.
 * En selvhostet instans må ikke kalde Google med Mahopes konto-id (#1024).
 */
const CLOUD_GOOGLE_ADS_ID = "AW-18183663242";

/**
 * Google Ads-id'et, eller undefined når der ikke skal loades noget.
 *
 * Sættes eksplicit med NEXT_PUBLIC_GOOGLE_ADS_ID (bages ind ved build). TimeTrack
 * Cloud (NEXT_PUBLIC_BRAND=timetrack) falder tilbage til Mahopes konto, så Cloud
 * ikke ændrer adfærd; alt andet er slukket.
 *
 * Skal stå som bar `process.env.NEXT_PUBLIC_…`, ellers inliner Next ikke
 * værdien i klientbundtet.
 */
export function getGoogleAdsId(): string | undefined {
  const explicit = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID?.trim();
  if (explicit) return explicit;
  return getBrandId() === "timetrack" ? CLOUD_GOOGLE_ADS_ID : undefined;
}
