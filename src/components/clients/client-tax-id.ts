import type { z } from "zod";
import {
  isDenmark,
  isEuMemberState,
  isEuVatFormat,
  normalizeVatNumber,
} from "@/lib/org/region";

/**
 * Kundens skatte-id (fund 19): et dansk CVR-nummer med CVR-opslag, når
 * kunden ligger i Danmark, et EU-momsnummer med landekode i resten af EU, og
 * ellers landets eget skattenummer (fx et amerikansk EIN, "12-3456789").
 * Feltet er det samme (clients.cvr_number); kun etiket, opslag og format
 * skifter.
 */
export function isDanishClient(country: string | null | undefined): boolean {
  return isDenmark(country);
}

/** clients.cvr_number er varchar(20); serveren afviser længere værdier. */
export const CLIENT_TAX_ID_MAX_LENGTH = 20;

/**
 * Zod-tjek: et momsnummer i et EU-land uden for Danmark skal have EU-formen;
 * andre lande får kun længdegrænsen. `unchanged` er den gemte værdi på en
 * eksisterende kunde: den afvises ikke, så et ældre nummer i et andet format
 * ikke spærrer for at gemme kunden.
 */
export function checkClientTaxId(
  data: { country?: string; cvrNumber?: string },
  ctx: z.RefinementCtx,
  messages: { vatInvalid: string; tooLong: string },
  unchanged?: string | null,
): void {
  const value = data.cvrNumber?.trim();
  if (!value) return;
  if (unchanged && value === unchanged.trim()) return;
  if (value.length > CLIENT_TAX_ID_MAX_LENGTH) {
    ctx.addIssue({
      code: "custom",
      path: ["cvrNumber"],
      message: messages.tooLong,
    });
    return;
  }
  if (isEuMemberState(data.country) && !isEuVatFormat(value)) {
    ctx.addIssue({
      code: "custom",
      path: ["cvrNumber"],
      message: messages.vatInvalid,
    });
  }
}

/**
 * Værdien, der gemmes: et EU-momsnummer normaliseres ("de 123 456 789" →
 * "DE123456789"); alt andet gemmes som skrevet (uden omgivende mellemrum).
 */
export function normalizeClientTaxId(
  country: string | null | undefined,
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return isEuMemberState(country) && isEuVatFormat(trimmed)
    ? normalizeVatNumber(trimmed)
    : trimmed;
}
