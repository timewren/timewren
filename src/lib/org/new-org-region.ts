import { isHostAuthEnabled, toBrandKey } from "@/lib/auth/host-auth";
import { getBrandId } from "@/lib/brand-id";
import { regionForNewOrg, regionMetadata } from "./region";

/**
 * Regionsfelterne (valuta, land, sprog) til organizations.metadata for et
 * nyt arbejdsområde. Bruges af alle veje, der opretter en organisation: den
 * personlige workspace ved signup, organisationssiden (better-auth) og
 * enterprise-routeren. Produktet er ejerens brand med multibrand, ellers
 * build-brandet (selvhostet TimeWren); TimeTrack er altid DKK og Danmark.
 * Demoen (src/lib/demo/create-demo-account.ts) er altid TimeWren i EUR.
 * Organisationer fra før har ingen felter og læses som før.
 */
export function newOrgRegionMetadata(owner: {
  brand?: string | null;
  locale?: string | null;
}): Record<string, unknown> {
  const product = isHostAuthEnabled() ? toBrandKey(owner.brand) : getBrandId();
  return regionMetadata(regionForNewOrg(product, owner.locale));
}
