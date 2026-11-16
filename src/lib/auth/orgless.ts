import { sharedT } from "@/i18n/shared-text";

/**
 * Svar til en bruger uden aktiv organisation (fx et fjernet medlem), når en
 * flade ellers ville falde tilbage til brugerens egne rækker og dermed vise
 * data fra den organisation, brugeren ikke længere er medlem af.
 */
export const ORGLESS_FORBIDDEN_MESSAGE =
  "Du er ikke medlem af en organisation. Bed om en ny invitation, eller kontakt support.";

/** Samme besked på kaldets sprog (dansk uden kontekst). */
export function orglessForbiddenMessage(locale?: string | null): string {
  return sharedT("sharedLabels", "orglessForbidden", undefined, locale);
}
