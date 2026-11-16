import { hashToken, revealToken } from "@/lib/security/token-hash";
import { encryptSecret } from "@/lib/utils/encryption";

/**
 * Kolonner for et nyt portal-adgangstoken (#713): hash til opslag og enc:v1
 * så linket kan vises igen i UI og mails. Klartekst gemmes ikke (#726).
 */
export function portalAccessTokenFields(token: string) {
  return {
    accessTokenHash: hashToken(token),
    accessTokenEncrypted: encryptSecret(token),
  };
}

/** Kolonner der fjerner portal-adgangstokenet helt (fx skift til konto-adgang). */
export const clearedPortalAccessTokenFields = {
  accessTokenHash: null,
  accessTokenEncrypted: null,
} as const;

/** Portal-adgangstokenet i klartekst til visning (dekrypteret fra enc:v1). */
export function readPortalAccessToken(row: {
  accessTokenEncrypted: string | null;
}): string | null {
  return revealToken(row.accessTokenEncrypted);
}
