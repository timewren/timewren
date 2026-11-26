import { brand, getWebHost } from '~/features/server/server-config';
import { webHostFromUrl } from '~/features/server/server-logic';

/**
 * Faste interpolationsvariabler i alle oversættelser, så TimeWren ikke viser TimeTracks navn
 * eller adresser. `webHost` følger den server, brugeren er logget ind på (selvhostet med port).
 */
export function brandVariables() {
  return {
    appName: brand.name,
    site: webHostFromUrl(brand.websiteUrl, brand.websiteUrl),
    webHost: getWebHost(),
  };
}
