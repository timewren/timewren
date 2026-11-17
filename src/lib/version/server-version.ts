import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deployedVersion } from "@/lib/pwa/version";

/**
 * Den kørende deployments version (server-side). Åbne faner sammenligner med
 * den værdi, de selv er bygget med, og tilbyder "Ny version — genindlæs".
 *
 * Kilde: APP_VERSION (git-SHA fra CI, læst ved kørsel; se deployedVersion),
 * ellers Next' BUILD_ID, ellers processens starttidspunkt (skifter ved hver
 * container-genstart).
 */
const STARTED_AT = String(Date.now());

function resolveVersion(): string {
  // Samme værdi som DocumentLayout skriver på <html> (src/lib/pwa/version.ts).
  const deployed = deployedVersion();
  if (deployed) return deployed;
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
