import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Den kørende deployments version (server-side). Åbne faner sammenligner med
 * den værdi, de selv er bygget med, og tilbyder "Ny version — genindlæs".
 *
 * Kilde: NEXT_PUBLIC_APP_VERSION (git-SHA fra CI, bagt ind ved build),
 * ellers Next' BUILD_ID, ellers processens starttidspunkt (skifter ved hver
 * container-genstart).
 */
const STARTED_AT = String(Date.now());

function resolveVersion(): string {
  // Samme værdi som klientbundtet har bagt ind (src/lib/pwa/version.ts).
  if (process.env.NEXT_PUBLIC_APP_VERSION) {
    return process.env.NEXT_PUBLIC_APP_VERSION;
  }
  try {
    return readFileSync(
      join(process.cwd(), ".next", "BUILD_ID"),
      "utf-8",
    ).trim();
  } catch {
    return STARTED_AT;
  }
}

export const SERVER_VERSION = resolveVersion();
