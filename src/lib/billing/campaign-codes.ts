/**
 * Kampagnekoder: en længere gratis prøveperiode og en tidsbegrænset rabat
 * bagefter. Koden følger med fra et link (`?kode=`) via en cookie, eller
 * tastes i onboardingen. Rabatten gemmes på subscription-rækken
 * (discountPercent/discountExpiresAt) og synkroniseres til Alunta, når
 * kunden lægger betaling ind (checkout-webhooken).
 */
export interface CampaignCode {
  /** Store bogstaver, som brugeren ser den. */
  code: string;
  label: string;
  trialDays: number;
  /** Procentrabat efter prøveperioden. 0 = ingen rabat. */
  discountPercent: number;
  /** Antal måneder rabatten gælder efter prøveperioden. */
  discountMonths: number;
  /** Sidste dag koden kan indløses (YYYY-MM-DD, inklusive). */
  redeemUntil: string;
}

export const CAMPAIGN_CODE_COOKIE = "tt_kode";
export const CAMPAIGN_CODE_PARAM = "kode";

export const CAMPAIGN_CODES: readonly CampaignCode[] = [
  {
    code: "MGS-DIGITAL",
    label: "MGS Digital",
    trialDays: 60,
    discountPercent: 25,
    discountMonths: 12,
    redeemUntil: "2027-03-31",
  },
];

export function normalizeCampaignCode(
  raw: string | null | undefined,
): string | null {
  const code = raw?.trim().toUpperCase();
  return code && /^[A-Z0-9-]{3,50}$/.test(code) ? code : null;
}

/** Kampagnekoden fra link-cookien (kun i browseren). */
export function readCampaignCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CAMPAIGN_CODE_COOKIE}=`));
  return normalizeCampaignCode(match?.split("=")[1]);
}

/** Slår en kode op uden at tjekke indløsningsdatoen (fx ved betaling). */
export function findCampaignCode(
  raw: string | null | undefined,
  codes: readonly CampaignCode[] = CAMPAIGN_CODES,
): CampaignCode | null {
  const code = normalizeCampaignCode(raw);
  return code ? (codes.find((c) => c.code === code) ?? null) : null;
}

export function resolveCampaignCode(
  raw: string | null | undefined,
  now: Date = new Date(),
  codes: readonly CampaignCode[] = CAMPAIGN_CODES,
): CampaignCode | null {
  const campaign = findCampaignCode(raw, codes);
  if (!campaign) return null;
  // redeemUntil er inklusive og i dansk tid — sammenlign på kalenderdato.
  const today = now.toLocaleDateString("sv-SE", {
    timeZone: "Europe/Copenhagen",
  });
  return today <= campaign.redeemUntil ? campaign : null;
}

/** Rabatten udløber `discountMonths` måneder efter prøveperiodens slut. */
export function campaignDiscountExpiresAt(
  campaign: CampaignCode,
  trialEndsAt: Date,
): Date | null {
  if (campaign.discountPercent <= 0) return null;
  const expires = new Date(trialEndsAt);
  expires.setMonth(expires.getMonth() + campaign.discountMonths);
  return expires;
}

/**
 * Slutdato for kampagnerabatten i Alunta, regnet fra betalingsdagen: mindst
 * `discountMonths` måneder efter `paidAt`, og aldrig før den dato, der blev
 * lovet ved onboardingen.
 */
export function campaignDiscountEndForPayment(
  campaign: CampaignCode,
  paidAt: Date,
  promisedEnd: Date | null,
): Date {
  const end = new Date(paidAt);
  end.setMonth(end.getMonth() + campaign.discountMonths);
  return promisedEnd && promisedEnd > end ? promisedEnd : end;
}

/** "60 dages gratis prøve + 25 % rabat i 12 måneder". */
export function describeCampaign(campaign: CampaignCode): string {
  const trial = `${campaign.trialDays} dages gratis prøve`;
  if (campaign.discountPercent <= 0) return trial;
  return `${trial} + ${campaign.discountPercent} % rabat i ${campaign.discountMonths} måneder`;
}
