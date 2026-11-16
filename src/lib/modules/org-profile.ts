export type OrgProfile = "freelance" | "enterprise";

/**
 * Org-profil (#452): en eksplicit `metadata.type` vinder ALTID over
 * modul-heuristikken — både "enterprise" og "freelance". Kun uden eksplicit
 * type gættes der: enterprise-modulet slået til mens klient-modulet er slået
 * fra (intern tidsregistrering uden freelance-CRM) ⇒ enterprise.
 */
export function resolveOrgProfile(
  metadataType: string | null | undefined,
  moduleOn: (key: string) => boolean,
): OrgProfile {
  if (metadataType === "enterprise") return "enterprise";
  if (metadataType === "freelance") return "freelance";
  return moduleOn("enterprise") && !moduleOn("clients")
    ? "enterprise"
    : "freelance";
}
